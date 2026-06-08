-- ============================================================================
-- Agregar columna thumb_url a catalog_products
-- ============================================================================
-- Requerido por:
--   - scrapping_apply_exact_catalog_matches (paso 1 v3)
--   - scrapping_confirm_auto_tentative_matches (confirmacion paso 2)
--
-- Estas funciones actualizan el thumb_url del maestro cuando un producto
-- retail hace match y trae una imagen.
-- ============================================================================

alter table public.catalog_products
  add column if not exists thumb_url text;

comment on column public.catalog_products.thumb_url is
  'URL de miniatura/imagen del producto maestro. Se actualiza desde el scrapping cuando esta vacio.';
