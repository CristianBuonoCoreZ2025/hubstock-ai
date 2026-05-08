-- Optimización del modelo retail: índices consultivos, RPC de precios en una pasada,
-- listados con description_hint y candidatos de homologación con prefiltro + respaldo.

comment on column public.catalog_retail_snapshots.retailer is
  'Identificador de cadena: lider, jumbo, central_mayorista, etc.';

create index if not exists idx_catalog_retail_links_catalog_product_retailer
  on public.catalog_retail_links (catalog_product_id, retailer);

comment on index public.idx_catalog_retail_links_catalog_product_retailer is
  'Acelera consultas de último precio por producto maestro y cadena.';

-- Último precio por cadena en una sola lectura (evita subconsultas correlacionadas repetidas).
create or replace function public.catalog_retail_prices_for_products(p_product_ids uuid[])
returns table (
  catalog_product_id uuid,
  retail_price_lider numeric,
  retail_price_jumbo numeric,
  retail_price_central_mayorista numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with pid as (
    select distinct unnest(coalesce(p_product_ids, array[]::uuid[])) as catalog_product_id
  ),
  ranked as (
    select
      lk.catalog_product_id,
      lk.retailer,
      s.price,
      row_number() over (
        partition by lk.catalog_product_id, lk.retailer
        order by s.captured_at desc nulls last
      ) as rn
    from public.catalog_retail_links lk
    inner join public.catalog_retail_snapshots s
      on s.retailer = lk.retailer and s.external_ref = lk.external_ref
    where lk.catalog_product_id in (select catalog_product_id from pid)
  ),
  latest as (
    select catalog_product_id, retailer, price
    from ranked
    where rn = 1
  )
  select
    p.catalog_product_id,
    max(l.price) filter (where l.retailer = 'lider'),
    max(l.price) filter (where l.retailer = 'jumbo'),
    max(l.price) filter (where l.retailer = 'central_mayorista')
  from pid p
  left join latest l on l.catalog_product_id = p.catalog_product_id
  group by p.catalog_product_id;
$$;

comment on function public.catalog_retail_prices_for_products(uuid[]) is
  'Último precio por cadena (lider, jumbo, central_mayorista) para maestros con vínculo; una pasada sobre links + snapshots.';

grant execute on function public.catalog_retail_prices_for_products(uuid[]) to authenticated;
grant execute on function public.catalog_retail_prices_for_products(uuid[]) to service_role;

-- Listado: incluye description_hint para homologación avanzada y búsqueda.
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
  description_hint text,
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
      s.description_hint,
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
      l.description_hint,
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
        or lower(coalesce(l.description_hint, '')) like '%' || v_search || '%'
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
    j.description_hint,
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
  'Listado de últimos precios por ítem externo (incluye description_hint); total_count repetido por fila.';

grant execute on function public.catalog_retail_listings_page(text, boolean, text, integer, integer)
  to authenticated;

-- Candidatos: prefiltro con pg_trgm (%); si no hay filas, mismo puntaje sobre catálogo activo (comportamiento previo).
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
  with narrowed as materialized (
    select
      cp.id as pid,
      cp.name as pname,
      cp.category_id as cid,
      cp.default_reference_price as dref,
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
      )::numeric as sc
    from public.catalog_products cp
    where cp.active = true
      and (
        length(trim(coalesce(p_search_title, ''))) < 2
        or public.catalog_text_search_norm(cp.name)
          % public.catalog_text_search_norm(trim(coalesce(p_search_title, '')))
        or (p_category_id is not null and cp.category_id = p_category_id)
      )
  ),
  fallback as (
    select
      cp.id as pid,
      cp.name as pname,
      cp.category_id as cid,
      cp.default_reference_price as dref,
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
      )::numeric as sc
    from public.catalog_products cp
    where cp.active = true
      and not exists (select 1 from narrowed)
  ),
  merged as (
    select * from narrowed
    union all
    select * from fallback
  )
  select
    merged.pid as catalog_product_id,
    merged.pname as product_name,
    merged.cid as category_id,
    merged.dref as default_reference_price,
    merged.sc as match_score
  from merged
  order by merged.sc desc
  limit greatest(1, least(coalesce(p_limit, 15), 50));
$$;

comment on function public.catalog_retail_match_candidates(text, numeric, uuid, integer) is
  'Sugerencias de maestro; prefiltro trigrama + categoría cuando hay texto; respaldo al comportamiento global si el prefiltro no devuelve filas.';

grant execute on function public.catalog_retail_match_candidates(text, numeric, uuid, integer)
  to authenticated;

analyze public.catalog_retail_snapshots;
analyze public.catalog_retail_links;
