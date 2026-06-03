-- ============================================================================
-- Migracion: Agregar image_url a catalog_retail_snapshots.
--
-- Contexto:
--   La funcion scrapping_create_new_products_all (20260703000400) inserta
--   image_url en catalog_retail_snapshots, pero la columna nunca existio.
--   Esto causaba el error 42703 al ejecutar la funcion.
--
-- Cambios:
--   1. Agrega columna image_url a catalog_retail_snapshots.
-- ============================================================================

alter table public.catalog_retail_snapshots
  add column if not exists image_url text;
