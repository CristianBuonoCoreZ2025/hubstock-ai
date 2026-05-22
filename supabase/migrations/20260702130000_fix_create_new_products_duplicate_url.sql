-- Fix: evita error 23505 cuando dos filas pending_new comparten la misma URL.
-- Crea UN solo producto maestro por URL duplicada dentro del lote.

create or replace function public.scrapping_create_new_products_all()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_processed int := 0;
  v_created   int := 0;
  v_recovered int := 0;
  v_skipped   int := 0;
  v_fallback_section_id uuid;
  v_fallback_category_id uuid;
begin
  -- Fallback General / Sin categoria
  insert into public.sections (name, sort_order) values ('General', 0) on conflict do nothing;
  select id into v_fallback_section_id from public.sections where name = 'General' limit 1;
  insert into public.categories (section_id, name, sort_order) values (v_fallback_section_id, 'Sin categoria', 0) on conflict do nothing;
  select id into v_fallback_category_id from public.categories where section_id = v_fallback_section_id and name = 'Sin categoria' limit 1;

  -- Cargar pending_new
  create temp table _tmp_new_products on commit drop as
  select
    s.id as scrapping_id,
    gen_random_uuid() as catalog_product_id,
    s.retailer,
    s.external_ref,
    trim(s.product_name) as name,
    public.catalog_text_search_norm(trim(s.product_name)) as name_norm,
    nullif(trim(s.brand), '') as brand,
    case when s.price > 0 then s.price else null end as price,
    nullif(trim(s.product_url), '') as url,
    coalesce(
      (select m.category_id from public.retail_taxonomy_mappings m
       where m.retailer = s.retailer
         and m.normalized_external_section = public.catalog_text_search_norm(nullif(trim(s.sections), ''))
         and m.normalized_external_category = public.catalog_text_search_norm(nullif(trim(s.categories), ''))
         and m.status = 'linked' limit 1),
      v_fallback_category_id
    ) as best_category_id,
    coalesce(
      (select m.section_id from public.retail_taxonomy_mappings m
       where m.retailer = s.retailer
         and m.normalized_external_section = public.catalog_text_search_norm(nullif(trim(s.sections), ''))
         and m.normalized_external_category = public.catalog_text_search_norm(nullif(trim(s.categories), ''))
         and m.status = 'linked' limit 1),
      v_fallback_section_id
    ) as best_section_id
  from public.scrapping s
  where s.catalog_match_status = 'pending_new';

  get diagnostics v_processed = row_count;
  if v_processed = 0 then
    return jsonb_build_object('processed', 0, 'created', 0, 'recovered', 0, 'skipped', 0, 'total', 0);
  end if;

  -- Detectar duplicados por nombre en catalog_products existentes
  create temp table _tmp_existing_names on commit drop as
  select distinct on (cpn.name_norm)
    cpn.name_norm,
    cp.id as existing_id
  from _tmp_new_products cpn
  inner join public.catalog_products cp
    on public.catalog_text_search_norm(cp.name) = cpn.name_norm;

  update _tmp_new_products t
  set catalog_product_id = e.existing_id
  from _tmp_existing_names e
  where t.name_norm = e.name_norm;

  get diagnostics v_recovered = row_count;

  -- Detectar duplicados por URL en catalog_products existentes
  create temp table _tmp_existing_urls on commit drop as
  select distinct on (cp.source_product_url)
    cp.source_product_url as url,
    cp.id as existing_id
  from public.catalog_products cp
  where cp.source_product_url is not null
    and cp.source_product_url in (select t.url from _tmp_new_products t where t.url is not null);

  update _tmp_new_products t
  set catalog_product_id = e.existing_id
  from _tmp_existing_urls e
  where t.url = e.url;

  -- FIX: si dos filas pending_new comparten URL, deben usar el MISMO catalog_product_id.
  -- Elige el mejor: existing_id > nuevo UUID; entre nuevos, el menor UUID.
  update _tmp_new_products t1
  set catalog_product_id = (
    select t2.catalog_product_id
    from _tmp_new_products t2
    where t2.url = t1.url
    order by
      case when t2.catalog_product_id in (
        select existing_id from _tmp_existing_names
        union
        select existing_id from _tmp_existing_urls where existing_id is not null
      ) then 0 else 1 end,
      t2.catalog_product_id
    limit 1
  )
  where t1.url is not null;

  -- Insertar maestros nuevos (solo los que no son recuperados)
  create temp table _tmp_cat_max_sort on commit drop as
  select best_category_id as cat_id, coalesce(max(sort_order), -1) as mx
  from (select distinct best_category_id from _tmp_new_products) d
  left join public.catalog_products cp on cp.category_id = d.best_category_id
  group by best_category_id;

  with to_create as (
    select
      catalog_product_id,
      name,
      brand,
      price,
      url,
      best_section_id,
      best_category_id,
      row_number() over (partition by best_category_id order by scrapping_id) as rn
    from _tmp_new_products t
    where t.catalog_product_id not in (
      select existing_id from _tmp_existing_names
      union
      select existing_id from _tmp_existing_urls where existing_id is not null
    )
  )
  insert into public.catalog_products (
    id, section_id, category_id, name, brand, format, unit,
    default_reference_price, sort_order, active,
    source_system, source_product_url
  )
  select
    tc.catalog_product_id,
    tc.best_section_id,
    tc.best_category_id,
    tc.name,
    tc.brand,
    null, null,
    tc.price,
    cms.mx + tc.rn,
    true,
    'scrapping_homologation',
    tc.url
  from to_create tc
  left join _tmp_cat_max_sort cms on cms.cat_id = tc.best_category_id
  on conflict (id) do nothing;

  get diagnostics v_created = row_count;

  -- Links retail
  insert into public.catalog_retail_links (retailer, external_ref, catalog_product_id, updated_at)
  select retailer, external_ref, catalog_product_id, now()
  from _tmp_new_products
  on conflict (retailer, external_ref) do update
  set catalog_product_id = excluded.catalog_product_id, updated_at = now();

  -- Aliases
  insert into public.catalog_product_aliases (catalog_product_id, alias_normalized)
  select distinct catalog_product_id, name_norm
  from _tmp_new_products
  where name_norm is not null
  on conflict (catalog_product_id, alias_normalized) do nothing;

  -- Marcar scrapping como matched
  update public.scrapping s
  set
    catalog_match_status = 'matched',
    catalog_product_id = t.catalog_product_id,
    catalog_match_confidence = 1.0,
    catalog_match_method = 'homologation_create_new',
    catalog_match_reviewed_at = now(),
    catalog_match_reviewed_by = auth.uid()
  from _tmp_new_products t
  where s.id = t.scrapping_id;

  v_skipped := v_processed - v_created - v_recovered;

  return jsonb_build_object(
    'processed', v_processed,
    'created', v_created,
    'recovered', v_recovered,
    'skipped', v_skipped,
    'total', v_processed
  );
end;
$$;
