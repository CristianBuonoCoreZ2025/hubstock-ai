-- Agregar columna is_active a retail (requerida por list_retail_for_scrapping)
-- y activar Jumbo si fue insertado.

alter table public.retail
  add column if not exists is_active boolean not null default true;

-- Asegurar que Jumbo esté activo si ya existe
update public.retail
  set is_active = true
  where lower(name) = 'jumbo' and is_active is null;
