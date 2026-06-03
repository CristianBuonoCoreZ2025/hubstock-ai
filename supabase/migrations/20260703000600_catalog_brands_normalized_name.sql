-- ============================================================================
-- Migracion: Agregar normalized_name a catalog_brands.
--
-- Contexto:
--   La funcion scrapping_create_new_products_all (20260703000400) usa
--   normalized_name para deduplicar marcas, pero la columna no existia.
--   Esto causaba el error 42703 al ejecutar la funcion.
--
-- Cambios:
--   1. Agrega columna normalized_name a catalog_brands.
--   2. Rellena registros existentes con catalog_text_search_norm(name).
--   3. Crea indice unico para deduplicacion (usado por ON CONFLICT).
-- ============================================================================

alter table public.catalog_brands
  add column if not exists normalized_name text;

update public.catalog_brands
  set normalized_name = public.catalog_text_search_norm(name)
  where normalized_name is null or normalized_name = '';

create unique index if not exists idx_catalog_brands_normalized_name_unique
  on public.catalog_brands (normalized_name);
