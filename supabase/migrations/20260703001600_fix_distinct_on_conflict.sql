-- ============================================================================
-- Migracion: Fix DISTINCT ON para evitar duplicados en ON CONFLICT DO UPDATE.
--
-- Problema:
--   DISTINCT sc.retailer, sc.external_ref, sc.catalog_product_id NO evita
--   duplicados cuando el mismo (retailer, external_ref) tiene diferentes
--   catalog_product_id. DISTINCT mantiene ambas filas porque difieren en
--   catalog_product_id, causando error 21000.
--
-- Fix:
--   Usar DISTINCT ON (sc.retailer, sc.external_ref) para elegir un solo
--   catalog_product_id por cada par (retailer, external_ref).
-- ============================================================================

create or replace function public.scrapping_create_new_products_all(p_limit int default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch_size        int  := coalesce(p_limit, 1000);
  v_processed_rows    int  := 0;
  v_unique_products   int  := 0;
  v_products_created  int  := 0;
  v_products_recovered int := 0;
  v_retail_links_created int := 0;
  v_retail_snapshots_created int := 0;
  v_taxonomy_mappings_created int := 0;
  v_taxonomy_pending  int  := 0;
  v_brands_created    int  := 0;
  v_aliases_created   int  := 0;
  v_image_pending     int  := 0;
  v_skipped           int  := 0;
  v_remaining         int  := 0;
begin
  -- ========================================================================
  -- PASO 1: Cargar candidatos pending_new (limitado por batch)
  -- ========================================================================
  create temp table _tmp_candidates on commit drop as
  select
    s.id                                          as scrapping_id,
    s.retailer,
    s.external_ref,
    trim(s.product_name)                          as product_name,
    public.catalog_text_search_norm(trim(s.product_name)) as name_norm,
    nullif(trim(s.brand), '')                     as brand_raw,
    public.catalog_text_search_norm(nullif(trim(s.brand), '')) as brand_norm,
    s.price,
    nullif(trim(s.product_url), '')                as product_url,
    nullif(trim(s.sections), '')                   as retail_section,
    nullif(trim(s.categories), '')                 as retail_category,
    public.catalog_text_search_norm(nullif(trim(s.sections), ''))   as retail_section_norm,
    public.catalog_text_search_norm(nullif(trim(s.categories), '')) as retail_category_norm,
    nullif(trim(s.image_url), '')                  as image_url
  from public.scrapping s
  where s.catalog_match_status = 'pending_new'
  order by s.id
  limit v_batch_size;

  get diagnostics v_processed_rows = row_count;

  if v_processed_rows = 0 then
    return jsonb_build_object(
      'processed_rows', 0, 'unique_products_detected', 0, 'products_created', 0,
      'products_recovered', 0, 'retail_links_created', 0, 'retail_snapshots_created', 0,
      'taxonomy_mappings_created', 0, 'taxonomy_pending', 0, 'brands_created', 0,
      'aliases_created', 0, 'image_pending', 0, 'skipped', 0, 'remaining', 0
    );
  end if;

  -- ========================================================================
  -- PASO 2: Revisar taxonomia existente (mapping linked)
  -- ========================================================================
  alter table _tmp_candidates
    add column mapped_section_id uuid,
    add column mapped_category_id uuid;

  update _tmp_candidates c
  set
    mapped_section_id = m.section_id,
    mapped_category_id = m.category_id
  from public.retail_taxonomy_mappings m
  where m.retailer = c.retailer
    and m.normalized_external_section = c.retail_section_norm
    and m.normalized_external_category = c.retail_category_norm
    and m.status = 'linked';

  -- ========================================================================
  -- PASO 3: Detectar productos unicos (name_norm + brand_norm + price)
  -- ========================================================================
  create temp table _tmp_product_keys on commit drop as
  select distinct name_norm, brand_norm, price
  from _tmp_candidates;

  select count(*) into v_unique_products from _tmp_product_keys;

  -- ========================================================================
  -- PASO 4: Elegir taxonomia ganadora por producto unico
  -- ========================================================================
  create temp table _tmp_product_taxonomy on commit drop as
  with group_mappings as (
    select
      c.name_norm,
      c.brand_norm,
      c.price,
      c.mapped_section_id,
      c.mapped_category_id,
      c.retail_section_norm,
      c.retail_category_norm,
      c.retailer,
      count(*) as freq_in_group
    from _tmp_candidates c
    group by c.name_norm, c.brand_norm, c.price,
             c.mapped_section_id, c.mapped_category_id,
             c.retail_section_norm, c.retail_category_norm,
             c.retailer
  ),
  with_direct_mapping as (
    select distinct on (name_norm, brand_norm, price)
      name_norm, brand_norm, price,
      mapped_section_id as winner_section_id,
      mapped_category_id as winner_category_id,
      retail_section_norm as winner_section_norm,
      retail_category_norm as winner_category_norm,
      retailer,
      'direct_mapping' as decision_reason
    from group_mappings
    where mapped_section_id is not null
    order by name_norm, brand_norm, price, freq_in_group desc
  ),
  without_direct_mapping as (
    select distinct on (g.name_norm, g.brand_norm, g.price)
      g.name_norm, g.brand_norm, g.price,
      null::uuid as winner_section_id,
      null::uuid as winner_category_id,
      g.retail_section_norm as winner_section_norm,
      g.retail_category_norm as winner_category_norm,
      g.retailer,
      'majority_frequency' as decision_reason
    from group_mappings g
    where not exists (
      select 1 from with_direct_mapping d
      where d.name_norm = g.name_norm
        and d.brand_norm = g.brand_norm
        and d.price = g.price
    )
    order by g.name_norm, g.brand_norm, g.price, g.freq_in_group desc
  )
  select * from with_direct_mapping
  union all
  select * from without_direct_mapping;

  -- ========================================================================
  -- PASO 5: Crear taxonomia interna para combinaciones sin mapping
  -- ========================================================================
  create temp table _tmp_new_taxonomy on commit drop as
  select distinct
    t.retailer,
    t.winner_section_norm as retail_section_norm,
    t.winner_category_norm as retail_category_norm,
    initcap(replace(replace(trim(t.winner_section_norm), '-', ' '), '_', ' ')) as clean_section_name,
    initcap(replace(replace(trim(t.winner_category_norm), '-', ' '), '_', ' ')) as clean_category_name
  from _tmp_product_taxonomy t
  where t.winner_section_id is null
    and t.winner_section_norm is not null
    and t.winner_section_norm <> ''
    and t.winner_category_norm is not null
    and t.winner_category_norm <> '';

  insert into public.sections (name, sort_order)
  select distinct clean_section_name, 0
  from _tmp_new_taxonomy
  where clean_section_name is not null
    and clean_section_name not in (select name from public.sections)
  on conflict do nothing;

  insert into public.categories (section_id, name, sort_order)
  select distinct s.id, nt.clean_category_name, 0
  from _tmp_new_taxonomy nt
  inner join public.sections s on s.name = nt.clean_section_name
  where nt.clean_category_name is not null
    and nt.clean_category_name not in (
      select c.name from public.categories c
      where c.section_id = s.id
    )
  on conflict do nothing;

  -- ========================================================================
  -- PASO 6: Crear retail_taxonomy_mappings para nuevas relaciones
  -- ========================================================================
  insert into public.retail_taxonomy_mappings (
    retailer, external_section, external_category,
    normalized_external_section, normalized_external_category,
    section_id, category_id, status, match_method, reason
  )
  select
    nt.retailer,
    nt.retail_section_norm,
    nt.retail_category_norm,
    nt.retail_section_norm,
    nt.retail_category_norm,
    s.id,
    c.id,
    'linked',
    'auto_create_new_v2',
    'Creado automaticamente desde scrapping_create_new_products_all v2'
  from _tmp_new_taxonomy nt
  inner join public.sections s on s.name = nt.clean_section_name
  inner join public.categories c on c.name = nt.clean_category_name and c.section_id = s.id
  where not exists (
    select 1 from public.retail_taxonomy_mappings m
    where m.retailer = nt.retailer
      and m.normalized_external_section = nt.retail_section_norm
      and m.normalized_external_category = nt.retail_category_norm
  )
  on conflict (retailer, normalized_external_section, normalized_external_category)
  do update set section_id = excluded.section_id,
                category_id = excluded.category_id,
                status = 'linked',
                updated_at = now();

  get diagnostics v_taxonomy_mappings_created = row_count;

  -- ========================================================================
  -- PASO 7: Resolver IDs finales de taxonomia
  -- ========================================================================
  alter table _tmp_candidates
    add column winner_category_id uuid,
    add column winner_section_id uuid;

  update _tmp_candidates c
  set
    winner_category_id = coalesce(c.mapped_category_id, m.category_id),
    winner_section_id = coalesce(c.mapped_section_id, m.section_id)
  from public.retail_taxonomy_mappings m
  where m.retailer = c.retailer
    and m.normalized_external_section = c.retail_section_norm
    and m.normalized_external_category = c.retail_category_norm
    and m.status = 'linked';

  -- ========================================================================
  -- PASO 8: Resolver marca
  -- ========================================================================
  alter table _tmp_candidates add column brand_id uuid;

  insert into public.catalog_brands (name, normalized_name)
  select distinct brand_raw, brand_norm
  from _tmp_candidates
  where brand_raw is not null
    and brand_norm is not null
    and brand_norm <> ''
    and not exists (
      select 1 from public.catalog_brands b where b.normalized_name = brand_norm
    )
  on conflict (normalized_name) do nothing;

  get diagnostics v_brands_created = row_count;

  update _tmp_candidates c
  set brand_id = b.id
  from public.catalog_brands b
  where b.normalized_name = c.brand_norm;

  -- ========================================================================
  -- PASO 9: Detectar duplicados por nombre normalizado + marca + precio
  -- ========================================================================
  create temp table _tmp_existing_products on commit drop as
  select distinct on (c.name_norm, c.brand_norm, c.price)
    c.name_norm,
    c.brand_norm,
    c.price,
    cp.id as existing_catalog_product_id
  from _tmp_candidates c
  inner join public.catalog_products cp
    on public.catalog_text_search_norm(cp.name) = c.name_norm
   and cp.brand_id = c.brand_id
   and cp.default_reference_price = c.price
   and cp.source_system in ('scrapping_homologation', 'scrapping_homologation_v2');

  select count(*) into v_products_recovered from _tmp_existing_products;

  -- ========================================================================
  -- PASO 10: Crear productos maestros nuevos
  -- ========================================================================
  create temp table _tmp_new_products on commit drop as
  select distinct on (c.name_norm, c.brand_norm, c.price)
    c.name_norm,
    c.brand_norm,
    c.price,
    c.winner_category_id,
    c.winner_section_id,
    gen_random_uuid() as new_catalog_product_id
  from _tmp_candidates c
  where not exists (
    select 1 from _tmp_existing_products ep
    where ep.name_norm = c.name_norm
      and ep.brand_norm = c.brand_norm
      and ep.price = c.price
  )
    and c.winner_category_id is not null
    and c.winner_section_id is not null;

  -- Pre-calcular sort_order max por categoria
  create temp table _tmp_cat_max_sort on commit drop as
  select cp.category_id as cat_id, max(cp.sort_order) as max_so
  from public.catalog_products cp
  where cp.category_id in (select winner_category_id from _tmp_new_products)
  group by cp.category_id;

  insert into public.catalog_products (
    id, name, section_id, category_id, brand, brand_id, format, unit,
    default_reference_price, sort_order, active, source_system
  )
  select distinct on (np.new_catalog_product_id)
    np.new_catalog_product_id,
    c.product_name,
    np.winner_section_id,
    np.winner_category_id,
    c.brand_raw,
    c.brand_id,
    c.name_norm,
    null,
    c.price,
    coalesce(cms.max_so, -1) + 1,
    true,
    'scrapping_homologation_v2'
  from _tmp_new_products np
  inner join _tmp_candidates c
    on c.name_norm = np.name_norm
    and c.brand_norm = np.brand_norm
    and c.price = np.price
  left join _tmp_cat_max_sort cms on cms.cat_id = np.winner_category_id
  order by np.new_catalog_product_id;

  get diagnostics v_products_created = row_count;

  -- ========================================================================
  -- PASO 11: Crear catalog_retail_links y catalog_retail_snapshots CON image_url
  -- ========================================================================
  create temp table _tmp_scrapping_catalog on commit drop as
  select
    c.scrapping_id,
    c.retailer,
    c.external_ref,
    c.product_url,
    c.price,
    c.product_name,
    c.image_url,
    coalesce(
      np.new_catalog_product_id,
      ep.existing_catalog_product_id
    ) as catalog_product_id
  from _tmp_candidates c
  left join _tmp_new_products np
    on np.name_norm = c.name_norm and np.brand_norm = c.brand_norm and np.price = c.price
  left join _tmp_existing_products ep
    on ep.name_norm = c.name_norm and ep.brand_norm = c.brand_norm and ep.price = c.price;

  -- FIX: DISTINCT ON (retailer, external_ref) elige un solo catalog_product_id
  --      por cada par, evitando duplicados en ON CONFLICT DO UPDATE.
  insert into public.catalog_retail_links (retailer, external_ref, catalog_product_id, updated_at)
  select distinct on (sc.retailer, sc.external_ref)
    sc.retailer, sc.external_ref, sc.catalog_product_id, now()
  from _tmp_scrapping_catalog sc
  where sc.catalog_product_id is not null
  order by sc.retailer, sc.external_ref, sc.catalog_product_id
  on conflict (retailer, external_ref) do update
  set catalog_product_id = excluded.catalog_product_id,
      updated_at = now();

  get diagnostics v_retail_links_created = row_count;

  -- FIX: DISTINCT ON (retailer, external_ref) para snapshots tambien.
  insert into public.catalog_retail_snapshots (
    retailer, external_ref, source_url, title, price, image_url, captured_at, match_method
  )
  select distinct on (sc.retailer, sc.external_ref)
    sc.retailer,
    sc.external_ref,
    sc.product_url,
    sc.product_name,
    sc.price,
    sc.image_url,
    now(),
    'scrapping_create_new_v2'
  from _tmp_scrapping_catalog sc
  where sc.catalog_product_id is not null
  order by sc.retailer, sc.external_ref;

  get diagnostics v_retail_snapshots_created = row_count;

  -- ========================================================================
  -- PASO 12: Crear catalog_product_media con la URL externa (bucket='external')
  -- ========================================================================
  insert into public.catalog_product_media (
    catalog_product_id, kind, bucket_id, object_path, public_url
  )
  select distinct
    sc.catalog_product_id,
    'thumbnail',
    'external',
    sc.image_url,
    sc.image_url
  from _tmp_scrapping_catalog sc
  where sc.catalog_product_id is not null
    and sc.image_url is not null
    and trim(sc.image_url) <> ''
  on conflict (catalog_product_id, kind) do update
  set bucket_id = excluded.bucket_id,
      object_path = excluded.object_path,
      public_url = excluded.public_url;

  -- ========================================================================
  -- PASO 13: Crear aliases
  -- ========================================================================
  insert into public.catalog_product_aliases (catalog_product_id, alias_normalized)
  select distinct sc.catalog_product_id, c.name_norm
  from _tmp_scrapping_catalog sc
  inner join _tmp_candidates c on c.scrapping_id = sc.scrapping_id
  where sc.catalog_product_id is not null
    and c.name_norm is not null
  on conflict (catalog_product_id, alias_normalized) do nothing;

  get diagnostics v_aliases_created = row_count;

  -- ========================================================================
  -- PASO 14: Marcar scrapping como matched
  -- ========================================================================
  update public.scrapping s
  set
    catalog_match_status = 'matched',
    matched_catalog_product_id = sc.catalog_product_id,
    catalog_matched_at = now(),
    homolog_final_status = 'CREATED_NEW',
    homolog_reviewed_at = now()
  from _tmp_scrapping_catalog sc
  where s.id = sc.scrapping_id
    and sc.catalog_product_id is not null;

  -- ========================================================================
  -- PASO 15: Contar restantes
  -- ========================================================================
  select count(*) into v_remaining
  from public.scrapping
  where catalog_match_status = 'pending_new';

  v_skipped := v_processed_rows - v_products_created - v_products_recovered - v_taxonomy_pending;
  v_image_pending := 0;

  return jsonb_build_object(
    'processed_rows', v_processed_rows,
    'unique_products_detected', v_unique_products,
    'products_created', v_products_created,
    'products_recovered', v_products_recovered,
    'retail_links_created', v_retail_links_created,
    'retail_snapshots_created', v_retail_snapshots_created,
    'taxonomy_mappings_created', v_taxonomy_mappings_created,
    'taxonomy_pending', v_taxonomy_pending,
    'brands_created', v_brands_created,
    'aliases_created', v_aliases_created,
    'image_pending', v_image_pending,
    'skipped', v_skipped,
    'remaining', v_remaining
  );
end;
$$;
