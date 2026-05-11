-- =============================================================================
-- Reset solo de capturas retail (partir de cero en precios por cadena).
-- =============================================================================
-- Qué borra:
--   - catalog_retail_snapshots  → historial de precios capturados por cadena
--   - catalog_retail_links      → homologación ítem tienda → maestro (NO borra catalog_products)
--   - retail_* (si existen)     → staging del pipeline por lotes
--
-- Qué NO toca:
--   - catalog_products, marcas, categorías, inventario, alias del maestro, etc.
--
-- Uso: Supabase → SQL Editor (rol con permiso de escritura en esas tablas), o psql.
-- En producción revisa dos veces antes de ejecutar.
-- =============================================================================

begin;

truncate table public.catalog_retail_snapshots;
truncate table public.catalog_retail_links;

-- Las tres tablas van en UNA sentencia: si se trunca hijo y padre por separado,
-- puede quedar la FK de retail_ai_match_reviews → retail_captured_products y falla.
do $body$
begin
  if to_regclass('public.retail_capture_batches') is not null then
    execute $q$
      truncate table
        public.retail_ai_match_reviews,
        public.retail_captured_products,
        public.retail_capture_pages,
        public.retail_capture_batches
      restart identity cascade
    $q$;
  end if;
end
$body$;

analyze public.catalog_retail_snapshots;
analyze public.catalog_retail_links;

commit;
