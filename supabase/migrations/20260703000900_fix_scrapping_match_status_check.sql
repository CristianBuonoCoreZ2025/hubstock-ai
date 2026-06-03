-- ============================================================================
-- Migracion: Agregar 'matched' al CHECK constraint de catalog_match_status.
--
-- Problema:
--   El constraint scrapping_catalog_match_status_check no incluia 'matched',
--   pero multiples funciones SQL y codigo TypeScript usan ese valor para
--   marcar filas de scrapping que ya fueron homologadas o creadas en catalogo.
--   Esto causaba error 23514 al ejecutar scrapping_create_new_products_all.
--
-- Cambios:
--   1. Reemplaza el CHECK constraint con uno que incluye 'matched'.
-- ============================================================================

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
      'catalog_created',
      'matched'
    )
  );
