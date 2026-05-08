-- Precios por cadena (snapshots + homologación a catalog_products).
-- Cada ejecución del importador inserta una fila nueva → historial de precios.
-- La tabla catalog_retail_links fija qué ítem externo corresponde a qué maestro del catálogo.

create table if not exists public.catalog_retail_snapshots (
  id uuid primary key default gen_random_uuid(),
  retailer text not null,
  external_ref text not null,
  source_url text,
  title text not null,
  price numeric not null,
  category_hint text,
  brand_hint text,
  captured_at timestamptz not null default now(),
  match_method text
);

comment on table public.catalog_retail_snapshots is
  'Captura puntual de precio desde una cadena (import script). Varias filas por (retailer, external_ref) = historial.';
comment on column public.catalog_retail_snapshots.retailer is
  'Identificador de cadena: lider, jumbo, etc.';
comment on column public.catalog_retail_snapshots.external_ref is
  'Clave estable del producto en la cadena (URL canónica, SKU o id del scraper).';
comment on column public.catalog_retail_snapshots.match_method is
  'Opcional: auto_import, manual_ui, etc.';

create index if not exists idx_catalog_retail_snapshots_retailer_ref_time
  on public.catalog_retail_snapshots (retailer, external_ref, captured_at desc);

create table if not exists public.catalog_retail_links (
  retailer text not null,
  external_ref text not null,
  catalog_product_id uuid not null references public.catalog_products (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (retailer, external_ref)
);

comment on table public.catalog_retail_links is
  'Homologación: producto externo (cadena + ref) → catalog_products.';

create index if not exists idx_catalog_retail_links_catalog_product_id
  on public.catalog_retail_links (catalog_product_id);

drop trigger if exists set_catalog_retail_links_updated_at on public.catalog_retail_links;
create trigger set_catalog_retail_links_updated_at
  before update on public.catalog_retail_links
  for each row execute function public.set_updated_at();

alter table public.catalog_retail_snapshots enable row level security;
alter table public.catalog_retail_links enable row level security;

drop policy if exists "catalog_retail_snapshots_select_authenticated" on public.catalog_retail_snapshots;
create policy "catalog_retail_snapshots_select_authenticated"
  on public.catalog_retail_snapshots for select
  to authenticated
  using (true);

drop policy if exists "catalog_retail_links_select_authenticated" on public.catalog_retail_links;
create policy "catalog_retail_links_select_authenticated"
  on public.catalog_retail_links for select
  to authenticated
  using (true);

-- Listado paginado: última captura por (retailer, external_ref) con vínculo al maestro si existe.
create or replace function public.catalog_retail_listings_page(
  p_retailer text,
  p_unlinked_only boolean,
  p_search text,
  p_page integer,
  p_page_size integer
)
returns table (
  snapshot_id uuid,
  retailer text,
  external_ref text,
  source_url text,
  title text,
  price numeric,
  category_hint text,
  brand_hint text,
  captured_at timestamptz,
  catalog_product_id uuid,
  linked_product_name text,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_lim int;
  v_off int;
  v_search text;
begin
  v_lim := greatest(coalesce(p_page_size, 100), 1);
  v_off := greatest(coalesce(p_page, 0), 0) * v_lim;
  v_search := nullif(trim(lower(public.unaccent(coalesce(p_search, '')))), '');

  return query
  with latest as (
    select distinct on (s.retailer, s.external_ref)
      s.id as snapshot_id,
      s.retailer,
      s.external_ref,
      s.source_url,
      s.title,
      s.price,
      s.category_hint,
      s.brand_hint,
      s.captured_at
    from public.catalog_retail_snapshots s
    order by s.retailer, s.external_ref, s.captured_at desc
  ),
  joined as (
    select
      l.snapshot_id,
      l.retailer,
      l.external_ref,
      l.source_url,
      l.title,
      l.price,
      l.category_hint,
      l.brand_hint,
      l.captured_at,
      lk.catalog_product_id,
      cp.name as linked_product_name
    from latest l
    left join public.catalog_retail_links lk
      on lk.retailer = l.retailer and lk.external_ref = l.external_ref
    left join public.catalog_products cp on cp.id = lk.catalog_product_id
    where (
        coalesce(nullif(trim(p_retailer), ''), null) is null
        or l.retailer = nullif(trim(p_retailer), '')
      )
      and (
        not coalesce(p_unlinked_only, false)
        or lk.catalog_product_id is null
      )
      and (
        v_search is null
        or length(v_search) < 2
        or public.catalog_text_search_norm(l.title) like '%' || v_search || '%'
        or lower(l.external_ref) like '%' || v_search || '%'
        or lower(coalesce(l.category_hint, '')) like '%' || v_search || '%'
      )
  ),
  tot as (
    select count(*)::bigint as c from joined
  )
  select
    j.snapshot_id,
    j.retailer,
    j.external_ref,
    j.source_url,
    j.title,
    j.price,
    j.category_hint,
    j.brand_hint,
    j.captured_at,
    j.catalog_product_id,
    j.linked_product_name,
    tot.c as total_count
  from joined j
  cross join tot
  order by j.captured_at desc
  limit v_lim offset v_off;
end;
$$;

comment on function public.catalog_retail_listings_page(text, boolean, text, integer, integer) is
  'Listado de últimos precios por ítem externo; total_count repetido por fila para paginación en cliente.';

grant execute on function public.catalog_retail_listings_page(text, boolean, text, integer, integer)
  to authenticated;

-- Candidatos para homologar (nombre similar + categoría + proximidad de precio).
create or replace function public.catalog_retail_match_candidates(
  p_search_title text,
  p_price numeric,
  p_category_id uuid,
  p_limit integer
)
returns table (
  catalog_product_id uuid,
  product_name text,
  category_id uuid,
  default_reference_price numeric,
  match_score numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    cp.id,
    cp.name,
    cp.category_id,
    cp.default_reference_price,
    (
      similarity(
        public.catalog_text_search_norm(cp.name),
        public.catalog_text_search_norm(coalesce(p_search_title, ''))
      ) * 0.50::double precision
      + case
          when p_category_id is not null and cp.category_id = p_category_id then 0.35::double precision
          else 0::double precision
        end
      + case
          when cp.default_reference_price is not null
            and coalesce(p_price, 0) > 0
          then greatest(
            0::double precision,
            0.25::double precision
              - (
                abs(cp.default_reference_price - p_price)
                / greatest(p_price::double precision, 1.0)
              )::double precision * 0.25::double precision
          )
          else 0.08::double precision
        end
    )::numeric as match_score
  from public.catalog_products cp
  where cp.active = true
  order by match_score desc
  limit greatest(1, least(coalesce(p_limit, 15), 50));
$$;

comment on function public.catalog_retail_match_candidates(text, numeric, uuid, integer) is
  'Sugerencias de maestro del catálogo para homologar un ítem retail (trigram + categoría + precio).';

grant execute on function public.catalog_retail_match_candidates(text, numeric, uuid, integer)
  to authenticated;
