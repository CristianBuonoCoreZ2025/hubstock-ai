-- ============================================================================
-- Migracion: Eliminar retail_taxonomy_mappings de Jumbo con section_id/category_id nulos.
--
-- Problema:
--   107 mappings de Jumbo tienen status='linked' pero section_id=null y
--   category_id=null. Esto causa que scrapping_create_new_products_all no
--   pueda resolver taxonomia, dejando winner_category_id/winner_section_id
--   como NULL y filtrando todo a skipped.
--
-- Cambios:
--   1. Borrar mappings de Jumbo con section_id IS NULL OR category_id IS NULL.
--   2. La funcion scrapping_create_new_products_all los recreara con IDs
--      correctos en PASO 5-6.
-- ============================================================================

delete from public.retail_taxonomy_mappings
where retailer = 'jumbo'
  and (section_id is null or category_id is null);
