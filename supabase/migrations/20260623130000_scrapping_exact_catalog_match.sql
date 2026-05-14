-- Homologación rápida scrapping → catalog_products (coincidencia exacta nombre + marca + precio).
-- Las filas scrapping con el mismo (product_name, brand, price) se marcan todas juntas.

alter table public.scrapping
  add column if not exists catalog_match_status text not null default 'pending';

alter table public.scrapping
  add column if not exists matched_catalog_product_id uuid references public.catalog_products (id) on delete set null;

alter table public.scrapping
  add column if not exists catalog_matched_at timestamptz;

comment on column public.scrapping.catalog_match_status is
  'pending: sin homologar a maestro. exact_match: nombre+marca+precio iguales a catalog_products (ruta rápida). Otros valores reservados para similitud / creación / vínculo manual.';

comment on column public.scrapping.matched_catalog_product_id is
  'Maestro catalog_products asociado tras homologación automática o manual.';

comment on column public.scrapping.catalog_matched_at is
  'Momento en que quedó resuelta la homologación automática (exact_match).';

alter table public.scrapping
  drop constraint if exists scrapping_catalog_match_status_check;

alter table public.scrapping
  add constraint scrapping_catalog_match_status_check
  check (
    catalog_match_status in (
      'pending',
      'exact_match',
      'pending_homolog',
      'pending_new',
      'manual_linked',
      'catalog_created'
    )
  );

create index if not exists idx_scrapping_catalog_match_pending
  on public.scrapping (catalog_match_status)
  where catalog_match_status = 'pending';

-- Coincidencia exacta: trim nombre, marca normalizada a minúsculas/trim, precio igual al maestro.
-- Si hay varios maestros duplicados, se elige el id menor.
create or replace function public.scrapping_apply_exact_catalog_matches()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_scrapping_matched int;
  v_catalog_updated int;
  v_distinct_masters int;
begin
  create temporary table _scr_exact on commit drop as
  select distinct on (s.id)
    s.id as scrapping_id,
    cp.id as catalog_id,
    s.price as scrapping_price
  from public.scrapping s
  inner join public.catalog_products cp
    on trim(s.product_name) = trim(cp.name)
    and lower(trim(coalesce(s.brand, ''))) = lower(trim(coalesce(cp.brand, '')))
    and s.price is not distinct from cp.default_reference_price
    and coalesce(cp.active, true) is true
  where s.catalog_match_status = 'pending'
  order by s.id, cp.id;

  select count(*)::int into v_scrapping_matched from _scr_exact;

  update public.scrapping s
  set
    catalog_match_status = 'exact_match',
    matched_catalog_product_id = e.catalog_id,
    catalog_matched_at = now()
  from _scr_exact e
  where s.id = e.scrapping_id;

  with touched as (
    select distinct catalog_id, scrapping_price
    from _scr_exact
  )
  update public.catalog_products cp
  set
    default_reference_price = t.scrapping_price,
    updated_at = now()
  from touched t
  where cp.id = t.catalog_id;

  get diagnostics v_catalog_updated = row_count;

  select count(distinct catalog_id)::int into v_distinct_masters from _scr_exact;

  return jsonb_build_object(
    'scrappingRowsMatched', coalesce(v_scrapping_matched, 0),
    'catalogProductsUpdated', coalesce(v_catalog_updated, 0),
    'distinctCatalogProducts', coalesce(v_distinct_masters, 0)
  );
end;
$$;

comment on function public.scrapping_apply_exact_catalog_matches() is
  'Marca filas scrapping en exact_match cuando nombre+marca+precio coinciden con catalog_products activo; actualiza default_reference_price y updated_at. Invocar solo con service_role desde servidor.';

revoke all on function public.scrapping_apply_exact_catalog_matches() from public;
grant execute on function public.scrapping_apply_exact_catalog_matches() to service_role;
