-- Acelera búsquedas tipo Google (ILIKE '%term%') en Catálogo.
-- Objetivo: reducir tiempo de búsqueda en /catalog para términos comunes (mayo/mayonesa/mostaza).
--
-- No destructivo: solo extensión + índices.

do $$
begin
  -- Requiere privilegios adecuados en el proyecto Supabase.
  create extension if not exists pg_trgm;
exception
  when insufficient_privilege then
    -- En algunos entornos el rol puede no permitir crear extensiones.
    -- Se deja el error explícito para resolverlo en el proyecto.
    raise;
end;
$$;

-- Índices trigram para acelerar ILIKE/LIKE con comodines.
-- Nota: estos índices benefician consultas como:
--   where name ilike '%mayo%'  (y también 'brand' y alias_normalized).

create index if not exists idx_catalog_products_name_trgm
  on public.catalog_products
  using gin (name gin_trgm_ops);

create index if not exists idx_catalog_products_brand_trgm
  on public.catalog_products
  using gin (brand gin_trgm_ops);

create index if not exists idx_catalog_product_aliases_alias_trgm
  on public.catalog_product_aliases
  using gin (alias_normalized gin_trgm_ops);

