-- ---------------------------------------------------------------------------
-- RPC: Crear productos maestros desde scrapping pending_new (todo atomico).
-- Reglas:
--   1. No crear duplicados: busca por nombre normalizado en catalog_products.
--   2. Mejor categoria: via mapeo de taxonomia Lider si existe y esta linked;
--      si no, usa fallback "General / Sin categoria".
--   3. Todo en un solo round-trip Postgres; sin limite de 1.000 filas.
-- ---------------------------------------------------------------------------

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
  v_max_sort int;
begin
  -- ========================================================================
  -- 1. Asegurar fallback "General / Sin categoria" (idempotente)
  -- ========================================================================
  insert into public.sections (name, sort_order)
  values ('General', 0)
  on conflict do nothing;

  select id into v_fallback_section_id
  from public.sections
  where name = 'General'
  limit 1;

  insert into public.categories (section_id, name, sort_order)
  values (v_fallback_section_id, 'Sin categoria', 0)
  on conflict do nothing;

  select id into v_fallback_category_id
  from public.categories
  where section_id = v_fallback_section_id and name = 'Sin categoria'
  limit 1;

  -- ========================================================================
  -- 2. Cargar scrapping pending_new con normalizacion y categoria mapeada
  -- ========================================================================
  create temp table _tmp_new_products on commit drop as
  select
    s.id                                          as scrapping_id,
    gen_random_uuid()                             as catalog_product_id,
    s.retailer,
    s.external_ref,
    trim(s.product_name)                          as name,
    public.catalog_text_search_norm(trim(s.product_name)) as name_norm,
    nullif(trim(s.brand), '')                     as brand,
    case when s.price > 0 then s.price else null end      as price,
    nullif(trim(s.product_url), '')                as url,
    nullif(trim(s.sections), '')                   as ext_section,
    nullif(trim(s.categories), '')                 as ext_category,
    -- mejor categoria: mapeo Lider linked > fallback
    coalesce(
      (select m.category_id
       from public.retail_taxonomy_mappings m
       where m.retailer = s.retailer
         and m.normalized_external_section = public.catalog_text_search_norm(nullif(trim(s.sections), ''))
         and m.normalized_external_category  = public.catalog_text_search_norm(nullif(trim(s.categories), ''))
         and m.status = 'linked'
       limit 1),
      v_fallback_category_id
    )                                             as best_category_id,
    coalesce(
      (select m.section_id
       from public.retail_taxonomy_mappings m
       where m.retailer = s.retailer
         and m.normalized_external_section = public.catalog_text_search_norm(nullif(trim(s.sections), ''))
         and m.normalized_external_category  = public.catalog_text_search_norm(nullif(trim(s.categories), ''))
         and m.status = 'linked'
       limit 1),
      v_fallback_section_id
    )                                             as best_section_id
  from public.scrapping s
  where s.catalog_match_status = 'pending_new';

  get diagnostics v_processed = row_count;

  if v_processed = 0 then
    return jsonb_build_object(
      'processed', 0,
      'created', 0,
      'recovered', 0,
      'skipped', 0,
      'total', 0
    );
  end if;

  -- ========================================================================
  -- 3. Detectar duplicados por nombre normalizado en catalog_products
  -- ========================================================================
  -- Marcar filas cuyo name_norm ya existe en catalog_products
  create temp table _tmp_existing_names on commit drop as
  select distinct on (cpn.name_norm)
    cpn.name_norm,
    cp.id as existing_id
  from _tmp_new_products cpn
  inner join public.catalog_products cp
    on public.catalog_text_search_norm(cp.name) = cpn.name_norm;

  -- Actualizar UUID de las recuperadas (por nombre duplicado)
  update _tmp_new_products t
  set catalog_product_id = e.existing_id
  from _tmp_existing_names e
  where t.name_norm = e.name_norm;

  get diagnostics v_recovered = row_count;

  -- ========================================================================
  -- 4. Detectar duplicados por URL (source_product_url)
  -- ========================================================================
  create temp table _tmp_existing_urls on commit drop as
  select distinct on (cp.source_product_url)
    cp.source_product_url as url,
    cp.id as existing_id
  from public.catalog_products cp
  where cp.source_product_url is not null
    and cp.source_product_url in (
      select t.url from _tmp_new_products t where t.url is not null
    );

  -- Priorizar coincidencia por URL sobre coincidencia por nombre
  update _tmp_new_products t
  set catalog_product_id = e.existing_id
  from _tmp_existing_urls e
  where t.url = e.url;

  -- ========================================================================
  -- 5. Insertar maestros nuevos (solo los que NO son recuperados)
  -- ========================================================================
  -- Calcular sort_order maximo por best_category_id
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
      row_number() over (
        partition by best_category_id
        order by scrapping_id
      ) as rn
    from _tmp_new_products t
    where t.catalog_product_id not in (
      select existing_id from _tmp_existing_names
      union
      select existing_id from _tmp_existing_urls
      where existing_id is not null
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
    null,
    null,
    tc.price,
    cms.mx + tc.rn,
    true,
    'scrapping_homologation',
    tc.url
  from to_create tc
  left join _tmp_cat_max_sort cms on cms.cat_id = tc.best_category_id;

  get diagnostics v_created = row_count;

  -- ========================================================================
  -- 6. Insertar links retail (evita duplicados)
  -- ========================================================================
  insert into public.catalog_retail_links (
    retailer, external_ref, catalog_product_id, updated_at
  )
  select retailer, external_ref, catalog_product_id, now()
  from _tmp_new_products
  on conflict (retailer, external_ref) do update
  set catalog_product_id = excluded.catalog_product_id,
      updated_at = now();

  -- ========================================================================
  -- 7. Insertar aliases normalizados (evita duplicados)
  -- ========================================================================
  insert into public.catalog_product_aliases (
    catalog_product_id, alias_normalized
  )
  select distinct
    catalog_product_id,
    name_norm
  from _tmp_new_products
  where name_norm is not null
  on conflict (catalog_product_id, alias_normalized) do nothing;

  -- ========================================================================
  -- 8. Marcar scrapping como matched
  -- ========================================================================
  update public.scrapping s
  set
    catalog_match_status       = 'matched',
    matched_catalog_product_id = t.catalog_product_id,
    homolog_final_status       = case
      when t.catalog_product_id in (
        select existing_id from _tmp_existing_names
        union
        select existing_id from _tmp_existing_urls where existing_id is not null
      ) then 'MATCHED_EXISTING'
      else 'CREATED_NEW'
    end,
    catalog_matched_at         = now(),
    homolog_reviewed_at      = now()
  from _tmp_new_products t
  where s.id = t.scrapping_id;

  -- ========================================================================
  -- 9. Cleanup
  -- ========================================================================
  return jsonb_build_object(
    'processed', v_processed,
    'created',   v_created,
    'recovered', v_recovered,
    'skipped',   v_skipped,
    'total',     v_processed
  );
end;
$$;

comment on function public.scrapping_create_new_products_all() is
  'Crea productos maestros desde scrapping pending_new: deduplica por nombre+URL, asigna mejor categoria via taxonomia mapeada, todo atomico. Invocar con service_role desde servidor.';

revoke all on function public.scrapping_create_new_products_all() from public;
grant execute on function public.scrapping_create_new_products_all() to service_role;
