-- ============================================================================
-- Script de REVISION: productos malos creados por scrapping_homologation v1.
-- Ejecutar ANTES del script de limpieza para validar.
-- ============================================================================

-- 1. Listar productos creados por la carga mala (source_system v1)
select
  cp.id as catalog_product_id,
  cp.name,
  cp.brand,
  cp.default_reference_price,
  s.name as section_name,
  c.name as category_name,
  cp.source_product_url,
  cp.source_system,
  cp.created_at,
  (select count(*) from public.catalog_retail_links lk where lk.catalog_product_id = cp.id) as retail_link_count,
  (select count(*) from public.catalog_product_aliases a where a.catalog_product_id = cp.id) as alias_count,
  (select count(*) from public.catalog_product_media m where m.catalog_product_id = cp.id) as media_count
from public.catalog_products cp
left join public.sections s on s.id = cp.section_id
left join public.categories c on c.id = cp.category_id
where cp.source_system in ('scrapping_homologation', 'scrapping_homologation_v2')
  and (
    s.name = 'General' or c.name = 'Sin categoria'
    or cp.section_id is null or cp.category_id is null
  )
order by cp.created_at desc;

-- 2. Cantidad total de productos malos
select count(*) as bad_products_count
from public.catalog_products cp
left join public.sections s on s.id = cp.section_id
left join public.categories c on c.id = cp.category_id
where cp.source_system in ('scrapping_homologation', 'scrapping_homologation_v2')
  and (
    s.name = 'General' or c.name = 'Sin categoria'
    or cp.section_id is null or cp.category_id is null
  );

-- 3. Scrapping vinculados a esos productos malos
select
  s.id as scrapping_id,
  s.retailer,
  s.external_ref,
  s.product_name,
  s.catalog_match_status,
  s.matched_catalog_product_id,
  cp.name as linked_product_name
from public.scrapping s
inner join public.catalog_products cp on cp.id = s.matched_catalog_product_id
left join public.sections sec on sec.id = cp.section_id
left join public.categories cat on cat.id = cp.category_id
where s.catalog_match_status = 'catalog_created'
  and cp.source_system in ('scrapping_homologation', 'scrapping_homologation_v2')
  and (
    sec.name = 'General' or cat.name = 'Sin categoria'
    or cp.section_id is null or cp.category_id is null
  );

-- 4. Resumen por seccion/categoria mala
select
  coalesce(s.name, 'NULL section') as section_name,
  coalesce(c.name, 'NULL category') as category_name,
  count(*) as product_count
from public.catalog_products cp
left join public.sections s on s.id = cp.section_id
left join public.categories c on c.id = cp.category_id
where cp.source_system in ('scrapping_homologation', 'scrapping_homologation_v2')
group by s.name, c.name
order by count(*) desc;
