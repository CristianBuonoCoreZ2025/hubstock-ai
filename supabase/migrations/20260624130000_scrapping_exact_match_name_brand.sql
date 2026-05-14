-- Paso 1 homologación: mismo nombre (trim) + misma marca (minúsculas/trim) que catalog_products activo.
-- Se actualiza default_reference_price en el maestro con el máximo precio visto en scrapping para ese par;
-- las filas scrapping homologadas se eliminan para dejar solo pendientes para pasos 2 y 3.

comment on column public.scrapping.catalog_match_status is
  'pending: pendiente de homologación. exact_match: legado (antes se marcaba sin borrar; ya no se usa al cerrar paso 1). pending_homolog / pending_new / manual_linked / catalog_created: reservados.';

create or replace function public.scrapping_apply_exact_catalog_matches()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_scrapping_removed int := 0;
  v_catalog_updated int := 0;
  v_distinct_masters int := 0;
begin
  create temporary table _catalog_key on commit drop as
  select distinct on (trim(cp.name), lower(trim(coalesce(cp.brand, ''))))
    trim(cp.name) as pn,
    lower(trim(coalesce(cp.brand, ''))) as bn,
    cp.id as catalog_id
  from public.catalog_products cp
  where coalesce(cp.active, true) is true
  order by trim(cp.name), lower(trim(coalesce(cp.brand, ''))), cp.id;

  create temporary table _scr_join on commit drop as
  select
    s.id as scrapping_id,
    k.catalog_id,
    s.price as row_price
  from public.scrapping s
  inner join _catalog_key k
    on trim(s.product_name) = k.pn
    and lower(trim(coalesce(s.brand, ''))) = k.bn
  where s.catalog_match_status = 'pending';

  create temporary table _cat_price on commit drop as
  select catalog_id, max(row_price) as new_price
  from _scr_join
  group by catalog_id;

  select count(*)::int into v_distinct_masters from _cat_price;

  update public.catalog_products cp
  set
    default_reference_price = p.new_price,
    updated_at = now()
  from _cat_price p
  where cp.id = p.catalog_id;

  get diagnostics v_catalog_updated = row_count;

  delete from public.scrapping s
  using _scr_join j
  where s.id = j.scrapping_id;

  get diagnostics v_scrapping_removed = row_count;

  -- Limpieza de filas legado exact_match (ya procesadas; el flujo actual borra al homologar).
  delete from public.scrapping
  where catalog_match_status = 'exact_match';

  return jsonb_build_object(
    'scrappingRowsRemoved', coalesce(v_scrapping_removed, 0),
    'catalogProductsUpdated', coalesce(v_catalog_updated, 0),
    'distinctCatalogProducts', coalesce(v_distinct_masters, 0)
  );
end;
$$;

comment on function public.scrapping_apply_exact_catalog_matches() is
  'Paso 1: scrapping pending con mismo nombre+marca que un catalog_products activo → actualiza default_reference_price (máx. precio scrapping) y borra esas filas scrapping. Luego borra legado exact_match.';
