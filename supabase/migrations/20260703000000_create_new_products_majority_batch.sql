-- ---------------------------------------------------------------------------
-- RPC: Crear productos maestros desde scrapping pending_new por lotes.
-- Cambios respecto a version anterior:
--   1. Parametro p_limit: procesa solo N pending_new por llamada (evita timeout).
--   2. "Mayoria gana" para seccion/categoria: cuando no hay mapeo directo
--      en retail_taxonomy_mappings, busca productos existentes con el MISMO
--      nombre normalizado y elige la seccion/categoria mas frecuente.
--   3. Retorna remaining: cuantos pending_new quedan para la siguiente llamada.
-- ---------------------------------------------------------------------------

create or replace function public.scrapping_create_new_products_all(p_limit int default null)
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
  v_remaining int := 0;
  v_fallback_section_id uuid;
  v_fallback_category_id uuid;
  v_batch_size int;
begin
  -- ========================================================================
  -- 0. Determinar batch size (default 1000 para evitar timeout)
  -- ========================================================================
  v_batch_size := coalesce(p_limit, 1000);

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
  -- 2. Cargar scrapping pending_new (limitado por batch size)
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
    -- mapeo directo de taxonomia (linked)
    (select m.category_id
     from public.retail_taxonomy_mappings m
     where m.retailer = s.retailer
       and m.normalized_external_section = public.catalog_text_search_norm(nullif(trim(s.sections), ''))
       and m.normalized_external_category  = public.catalog_text_search_norm(nullif(trim(s.categories), ''))
       and m.status = 'linked'
     limit 1)                                    as mapped_category_id,
    (select m.section_id
     from public.retail_taxonomy_mappings m
     where m.retailer = s.retailer
       and m.normalized_external_section = public.catalog_text_search_norm(nullif(trim(s.sections), ''))
       and m.normalized_external_category  = public.catalog_text_search_norm(nullif(trim(s.categories), ''))
       and m.status = 'linked'
     limit 1)                                    as mapped_section_id,
    null::uuid                                    as best_section_id,
    null::uuid                                    as best_category_id
  from public.scrapping s
  where s.catalog_match_status = 'pending_new'
  order by s.id
  limit v_batch_size;

  get diagnostics v_processed = row_count;

  if v_processed = 0 then
    return jsonb_build_object(
      'processed', 0,
      'created', 0,
      'recovered', 0,
      'skipped', 0,
      'total', 0,
      'remaining', 0
    );
  end if;

  -- ========================================================================
  -- 2b. "Mayoria gana": resolver seccion/categoria por nombre similar
  --     cuando no hay mapeo directo.
  -- ========================================================================
  -- Para cada pending_new sin mapeo directo, buscar productos existentes
  -- con el MISMO nombre normalizado y elegir la seccion/categoria mas frecuente.
  create temp table _tmp_name_majority on commit drop as
  select
    t.scrapping_id,
    cp.section_id as maj_section_id,
    cp.category_id as maj_category_id,
    count(*) as freq
  from _tmp_new_products t
  inner join public.catalog_products cp
    on public.catalog_text_search_norm(cp.name) = t.name_norm
  where t.mapped_category_id is null
  group by t.scrapping_id, cp.section_id, cp.category_id;

  create temp table _tmp_best_majority on commit drop as
  select distinct on (scrapping_id)
    scrapping_id,
    maj_section_id,
    maj_category_id
  from _tmp_name_majority
  order by scrapping_id, freq desc, maj_section_id, maj_category_id;

  -- Asignar best_section_id / best_category_id:
  --   1. Mapeo directo si existe
  --   2. Mayoria gana si no hay mapeo pero hay productos similares
  --   3. Fallback "General / Sin categoria" si no hay nada
  update _tmp_new_products t
  set
    best_section_id = coalesce(t.mapped_section_id, bm.maj_section_id, v_fallback_section_id),
    best_category_id = coalesce(t.mapped_category_id, bm.maj_category_id, v_fallback_category_id)
  from _tmp_best_majority bm
  where t.scrapping_id = bm.scrapping_id
    and t.mapped_section_id is null;

  -- Para los que NO tienen mapeo NI mayoria gana (no en _tmp_best_majority)
  update _tmp_new_products t
  set
    best_section_id = coalesce(t.mapped_section_id, v_fallback_section_id),
    best_category_id = coalesce(t.mapped_category_id, v_fallback_category_id)
  where t.best_section_id is null;

  -- ========================================================================
  -- 3. Detectar duplicados por nombre normalizado en catalog_products
  -- ========================================================================
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

  update _tmp_new_products t
  set catalog_product_id = e.existing_id
  from _tmp_existing_urls e
  where t.url = e.url;

  -- ========================================================================
  -- 4b. Unificar UUIDs para filas pending_new que comparten la misma URL
  -- ========================================================================
  with best_per_url as (
    select distinct on (url)
      url,
      catalog_product_id as best_id
    from _tmp_new_products
    where url is not null
    order by url,
      case when catalog_product_id in (
        select existing_id from _tmp_existing_names
        union
        select existing_id from _tmp_existing_urls where existing_id is not null
      ) then 0 else 1 end,
      catalog_product_id
  )
  update _tmp_new_products t
  set catalog_product_id = b.best_id
  from best_per_url b
  where t.url = b.url;

  -- ========================================================================
  -- 5. Insertar maestros nuevos (solo los que NO son recuperados)
  -- ========================================================================
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
  left join _tmp_cat_max_sort cms on cms.cat_id = tc.best_category_id
  on conflict (id) do nothing;

  get diagnostics v_created = row_count;

  -- ========================================================================
  -- 6. Insertar links retail
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
  -- 7. Insertar aliases normalizados
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
    catalog_product_id         = t.catalog_product_id,
    catalog_match_confidence   = 1.0,
    catalog_match_method       = 'homologation_create_new',
    catalog_match_reviewed_at  = now(),
    catalog_match_reviewed_by  = auth.uid()
  from _tmp_new_products t
  where s.id = t.scrapping_id;

  -- ========================================================================
  -- 9. Contar cuantos pending_new quedan
  -- ========================================================================
  select count(*) into v_remaining
  from public.scrapping
  where catalog_match_status = 'pending_new';

  v_skipped := v_processed - v_created - v_recovered;

  return jsonb_build_object(
    'processed', v_processed,
    'created', v_created,
    'recovered', v_recovered,
    'skipped', v_skipped,
    'total', v_processed,
    'remaining', v_remaining
  );
end;
$$;
