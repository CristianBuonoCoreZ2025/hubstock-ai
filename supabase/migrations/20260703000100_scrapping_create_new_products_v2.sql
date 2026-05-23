-- ============================================================================
-- RPC v2: Crear productos maestros desde scrapping pending_new.
-- FLUJO CORRECTO — sin fallback artificial, sin General, sin Sin categoria.
-- ============================================================================
-- Cambios respecto a v1:
--   1. No crea seccion General ni categoria Sin categoria.
--   2. Resuelve taxonomia ANTES de crear productos.
--   3. Detecta duplicados (name_norm + brand_norm + price) ANTES de crear.
--   4. Un solo catalog_product por producto unico aunque aparezca en 2 secciones retail.
--   5. Precio y URL del retail van a catalog_retail_links + catalog_retail_snapshots.
--   6. Marca se normaliza y resuelve via catalog_brands.
--   7. Sin taxonomia clara queda pending_taxonomy, NO se fuerza a categoria falsa.
--   8. Imagen queda pendiente para proceso posterior.
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
    public.catalog_text_search_norm(nullif(trim(s.categories), '')) as retail_category_norm
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
      count(*) as freq_in_group
    from _tmp_candidates c
    group by c.name_norm, c.brand_norm, c.price,
             c.mapped_section_id, c.mapped_category_id,
             c.retail_section_norm, c.retail_category_norm
  ),
  with_direct_mapping as (
    select distinct on (name_norm, brand_norm, price)
      name_norm, brand_norm, price,
      mapped_section_id as winner_section_id,
      mapped_category_id as winner_category_id,
      retail_section_norm as winner_section_norm,
      retail_category_norm as winner_category_norm,
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

  -- Crear secciones internas (si no existen)
  insert into public.sections (name, sort_order)
  select distinct clean_section_name, 0
  from _tmp_new_taxonomy
  where clean_section_name is not null
    and clean_section_name not in (select name from public.sections)
  on conflict do nothing;

  -- Crear categorias internas (si no existen), vinculadas a su seccion
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
    'lider',
    nt.retail_section_norm,
    nt.retail_category_norm,
    nt.retail_section_norm,
    nt.retail_category_norm,
    s.id,
    c.id,
    'linked',
    'auto_create_new_products_v2',
    'Creado automaticamente desde scrapping_create_new_products_all v2'
  from _tmp_new_taxonomy nt
  inner join public.sections s on s.name = nt.clean_section_name
  inner join public.categories c on c.name = nt.clean_category_name and c.section_id = s.id
  where not exists (
    select 1 from public.retail_taxonomy_mappings m
    where m.retailer = 'lider'
      and m.normalized_external_section = nt.retail_section_norm
      and m.normalized_external_category = nt.retail_category_norm
  )
  on conflict (retailer, normalized_external_section, normalized_external_category) do nothing;

  get diagnostics v_taxonomy_mappings_created = row_count;

  -- ========================================================================
  -- PASO 7: Volver a relacionar candidatos con taxonomia recien creada
  -- ========================================================================
  update _tmp_candidates c
  set
    mapped_section_id = m.section_id,
    mapped_category_id = m.category_id
  from public.retail_taxonomy_mappings m
  where c.mapped_section_id is null
    and m.retailer = c.retailer
    and m.normalized_external_section = c.retail_section_norm
    and m.normalized_external_category = c.retail_category_norm
    and m.status = 'linked';

  -- ========================================================================
  -- PASO 8: Resolver marcas
  -- ========================================================================
  insert into public.catalog_brands (name)
  select distinct initcap(trim(c.brand_raw))
  from _tmp_candidates c
  where c.brand_raw is not null
    and not exists (
      select 1 from public.catalog_brands b
      where lower(trim(b.name)) = lower(trim(c.brand_raw))
    )
  on conflict do nothing;

  get diagnostics v_brands_created = row_count;

  -- ========================================================================
  -- PASO 9: Detectar productos existentes en catalog_products
  -- ========================================================================
  create temp table _tmp_existing_products on commit drop as
  select distinct on (cpn.name_norm, cpn.brand_norm, cpn.price)
    cpn.name_norm,
    cpn.brand_norm,
    cpn.price,
    cp.id as existing_catalog_product_id
  from _tmp_product_keys cpn
  inner join public.catalog_products cp
    on public.catalog_text_search_norm(cp.name) = cpn.name_norm
    and public.catalog_text_search_norm(coalesce(cp.brand, '')) = coalesce(cpn.brand_norm, '');

  -- ========================================================================
  -- PASO 10: Preparar productos nuevos a crear
  -- ========================================================================
  create temp table _tmp_cat_max_sort on commit drop as
  select pt.winner_category_id as cat_id, coalesce(max(cp.sort_order), -1) as mx
  from _tmp_product_taxonomy pt
  left join public.catalog_products cp on cp.category_id = pt.winner_category_id
  where pt.winner_category_id is not null
  group by pt.winner_category_id;

  create temp table _tmp_new_products on commit drop as
  select
    gen_random_uuid() as new_catalog_product_id,
    pk.name_norm,
    pk.brand_norm,
    pk.price,
    pt.winner_section_id,
    pt.winner_category_id,
    (select trim(c.product_name) from _tmp_candidates c
     where c.name_norm = pk.name_norm and c.brand_norm = pk.brand_norm and c.price = pk.price
     order by length(trim(c.product_name)) asc limit 1) as best_name,
    (select trim(c.brand_raw) from _tmp_candidates c
     where c.name_norm = pk.name_norm and c.brand_norm = pk.brand_norm and c.price = pk.price
       and c.brand_raw is not null
     order by length(trim(c.brand_raw)) asc limit 1) as best_brand,
    (select b.id from public.catalog_brands b
     where lower(trim(b.name)) = lower(trim(
       (select c2.brand_raw from _tmp_candidates c2
        where c2.name_norm = pk.name_norm and c2.brand_norm = pk.brand_norm and c2.price = pk.price
          and c2.brand_raw is not null
        order by length(trim(c2.brand_raw)) asc limit 1)
     ))
     limit 1) as brand_id,
    row_number() over (partition by pt.winner_category_id order by pk.name_norm, pk.brand_norm) as rn
  from _tmp_product_keys pk
  inner join _tmp_product_taxonomy pt
    on pt.name_norm = pk.name_norm and pt.brand_norm = pk.brand_norm and pt.price = pk.price
  where not exists (
    select 1 from _tmp_existing_products ep
    where ep.name_norm = pk.name_norm
      and ep.brand_norm = pk.brand_norm
      and ep.price = pk.price
  )
    and pt.winner_section_id is not null
    and pt.winner_category_id is not null;

  -- Insertar productos maestros
  insert into public.catalog_products (
    id, section_id, category_id, name, brand, brand_id,
    default_reference_price, sort_order, active,
    source_system, source_product_url
  )
  select
    np.new_catalog_product_id,
    np.winner_section_id,
    np.winner_category_id,
    np.best_name,
    np.best_brand,
    np.brand_id,
    np.price,
    cms.mx + np.rn,
    true,
    'scrapping_homologation_v2',
    null
  from _tmp_new_products np
  left join _tmp_cat_max_sort cms on cms.cat_id = np.winner_category_id;

  get diagnostics v_products_created = row_count;
  select count(*) into v_products_recovered from _tmp_existing_products;

  -- ========================================================================
  -- PASO 11: Crear catalog_retail_links y catalog_retail_snapshots
  -- ========================================================================
  create temp table _tmp_scrapping_catalog on commit drop as
  select
    c.scrapping_id,
    c.retailer,
    c.external_ref,
    c.product_url,
    c.price,
    c.product_name,
    coalesce(
      np.new_catalog_product_id,
      ep.existing_catalog_product_id
    ) as catalog_product_id
  from _tmp_candidates c
  left join _tmp_new_products np
    on np.name_norm = c.name_norm and np.brand_norm = c.brand_norm and np.price = c.price
  left join _tmp_existing_products ep
    on ep.name_norm = c.name_norm and ep.brand_norm = c.brand_norm and ep.price = c.price;

  insert into public.catalog_retail_links (retailer, external_ref, catalog_product_id, updated_at)
  select sc.retailer, sc.external_ref, sc.catalog_product_id, now()
  from _tmp_scrapping_catalog sc
  where sc.catalog_product_id is not null
  on conflict (retailer, external_ref) do update
  set catalog_product_id = excluded.catalog_product_id,
      updated_at = now();

  get diagnostics v_retail_links_created = row_count;

  insert into public.catalog_retail_snapshots (
    retailer, external_ref, source_url, title, price, captured_at, match_method
  )
  select
    sc.retailer,
    sc.external_ref,
    sc.product_url,
    sc.product_name,
    sc.price,
    now(),
    'scrapping_create_new_v2'
  from _tmp_scrapping_catalog sc
  where sc.catalog_product_id is not null;

  get diagnostics v_retail_snapshots_created = row_count;

  -- ========================================================================
  -- PASO 12: Crear aliases
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
  -- PASO 13: Marcar scrapping
  -- ========================================================================
  update public.scrapping s
  set
    catalog_match_status       = 'catalog_created',
    matched_catalog_product_id = sc.catalog_product_id,
    catalog_matched_at         = now(),
    homolog_final_status       = case
      when exists (
        select 1 from _tmp_existing_products ep
        inner join _tmp_candidates c2
          on ep.name_norm = c2.name_norm and ep.brand_norm = c2.brand_norm and ep.price = c2.price
        where c2.scrapping_id = s.id
      ) then 'RECOVERED_EXISTING'
      else 'CREATED_NEW'
    end,
    homolog_reviewed_at        = now()
  from _tmp_scrapping_catalog sc
  where s.id = sc.scrapping_id
    and sc.catalog_product_id is not null;

  update public.scrapping s
  set
    catalog_match_status = 'pending_taxonomy',
    matched_catalog_product_id = null
  from _tmp_candidates c
  where s.id = c.scrapping_id
    and c.mapped_section_id is null;

  select count(*) into v_taxonomy_pending
  from public.scrapping
  where catalog_match_status = 'pending_taxonomy';

  -- ========================================================================
  -- PASO 14: Calcular image_pending
  -- ========================================================================
  select count(*) into v_image_pending
  from public.catalog_products cp
  where cp.source_system = 'scrapping_homologation_v2'
    and not exists (
      select 1 from public.catalog_product_media m where m.catalog_product_id = cp.id
    );

  -- ========================================================================
  -- PASO 15: Calcular remaining y skipped
  -- ========================================================================
  select count(*) into v_remaining
  from public.scrapping
  where catalog_match_status = 'pending_new';

  v_skipped := v_processed_rows - v_products_created - v_products_recovered - v_taxonomy_pending;

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
    'skipped', greatest(v_skipped, 0),
    'remaining', v_remaining
  );
end;
$$;
