-- ============================================================================
-- Migracion: Limpiar productos maestros creados desde scrapping y resetear
-- estado de scrapping para re-creacion.
--
-- Contexto:
--   Los tests de scrapping_create_new_products_all crearon ~1110 productos
--   maestros con source_system = 'scrapping_homologation_v2'. Se desea
--   limpiar todo y volver a crear desde cero.
--
-- Cambios:
--   1. Borra aliases, media, snapshots y links de productos de scrapping.
--   2. Resetea filas scrapping matched -> pending_new.
--   3. Borra productos maestros de scrapping.
-- ============================================================================

-- 1. Borrar aliases de productos de scrapping
delete from public.catalog_product_aliases
where catalog_product_id in (
  select id from public.catalog_products
  where source_system in ('scrapping_homologation', 'scrapping_homologation_v2')
);

-- 2. Borrar media de productos de scrapping
delete from public.catalog_product_media
where catalog_product_id in (
  select id from public.catalog_products
  where source_system in ('scrapping_homologation', 'scrapping_homologation_v2')
);

-- 3. Borrar snapshots de productos de scrapping
delete from public.catalog_retail_snapshots
where (retailer, external_ref) in (
  select retailer, external_ref from public.scrapping
  where catalog_match_status = 'matched'
);

-- 4. Borrar links de productos de scrapping
delete from public.catalog_retail_links
where catalog_product_id in (
  select id from public.catalog_products
  where source_system in ('scrapping_homologation', 'scrapping_homologation_v2')
);

-- 5. Resetear scrapping matched -> pending_new
update public.scrapping
set
  catalog_match_status = 'pending_new',
  matched_catalog_product_id = null,
  catalog_matched_at = null,
  homolog_final_status = null,
  homolog_reviewed_at = null
where catalog_match_status = 'matched';

-- 6. Borrar productos maestros de scrapping
delete from public.catalog_products
where source_system in ('scrapping_homologation', 'scrapping_homologation_v2');
