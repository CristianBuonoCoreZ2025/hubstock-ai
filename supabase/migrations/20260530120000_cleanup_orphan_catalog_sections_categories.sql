-- -----------------------------------------------------------------------------
-- Datos: elimina categorías y secciones globales sin ningún producto asociado
-- (`catalog_products` ni `products` por ubicación).
--
-- Operación DESTRUCTIVA (no reversible sin backup).
-- No altera políticas RLS ni esquema.
--
-- 1) Categorías no referenciadas por catálogo ni por inventario de perfiles.
-- 2) Secciones sin filas hijas categoría en uso y sin uso directo en productos.
-- -----------------------------------------------------------------------------

-- 1) Categorías huérfanas
delete from public.categories c
where not exists (
  select 1 from public.catalog_products cp where cp.category_id = c.id
)
and not exists (
  select 1 from public.products p where p.category_id = c.id
);

-- 2) Secciones huérfanas (evita FK y datos raros: no toca una sección con
-- alguna categoría aún enlazada a productos aunque el section_id coincida o no)
delete from public.sections s
where not exists (select 1 from public.catalog_products cp where cp.section_id = s.id)
and not exists (select 1 from public.products p where p.section_id = s.id)
and not exists (
  select 1
  from public.categories c
  where c.section_id = s.id
    and (
      exists (select 1 from public.catalog_products cp where cp.category_id = c.id)
      or exists (select 1 from public.products p where p.category_id = c.id)
    )
);
