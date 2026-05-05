/*
 * Catálogo maestro global: plantilla fija de productos + copia al perfil del hogar.
 * Las filas de catalog_products no tienen stock; products sigue siendo la verdad por perfil.
 *
 * En PostgreSQL los comentarios válidos son: -- texto  o  bloques como este.
 * No uses viñetas Markdown (- texto); eso produce: syntax error near "-".
 */

-- La migración core también define esto; aquí se repite para ejecutar solo esta migración si hace falta.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- catalog_products: definición canónica (misma taxonomía que products)
-- ---------------------------------------------------------------------------
create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  name text not null,
  brand text,
  format text,
  unit text,
  default_reference_price numeric,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_catalog_products_section on public.catalog_products (section_id);
create index if not exists idx_catalog_products_category on public.catalog_products (category_id);
create index if not exists idx_catalog_products_active_sort on public.catalog_products (active, sort_order);

drop trigger if exists set_catalog_products_updated_at on public.catalog_products;
create trigger set_catalog_products_updated_at
  before update on public.catalog_products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- catalog_product_aliases: texto externo (ej. boleta) -> maestro
-- ---------------------------------------------------------------------------
create table if not exists public.catalog_product_aliases (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references public.catalog_products (id) on delete cascade,
  alias_normalized text not null,
  created_at timestamptz not null default now(),
  unique (catalog_product_id, alias_normalized)
);

create index if not exists idx_catalog_product_aliases_lookup on public.catalog_product_aliases (alias_normalized);

-- ---------------------------------------------------------------------------
-- Enlace opcional: producto del hogar -> fila del catálogo maestro
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists catalog_product_id uuid references public.catalog_products (id) on delete set null;

create unique index if not exists idx_products_profile_catalog_unique
  on public.products (profile_id, catalog_product_id)
  where catalog_product_id is not null;

create index if not exists idx_products_catalog_product on public.products (catalog_product_id);

-- ---------------------------------------------------------------------------
-- RLS: catálogo global solo lectura para autenticados (escritura vía SQL/migraciones)
-- ---------------------------------------------------------------------------
alter table public.catalog_products enable row level security;
alter table public.catalog_product_aliases enable row level security;

drop policy if exists "catalog_products_select_authenticated" on public.catalog_products;
create policy "catalog_products_select_authenticated"
  on public.catalog_products for select
  to authenticated
  using (true);

drop policy if exists "catalog_product_aliases_select_authenticated" on public.catalog_product_aliases;
create policy "catalog_product_aliases_select_authenticated"
  on public.catalog_product_aliases for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Función: copiar plantilla al perfil (idempotente por catalog_product_id)
-- ---------------------------------------------------------------------------
create or replace function public.copy_catalog_products_to_profile(
  p_profile_id uuid,
  p_created_by uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if not exists (
    select 1 from public.profile_members pm
    where pm.profile_id = p_profile_id
      and pm.user_id = p_created_by
      and pm.status = 'active'
      and pm.role in ('admin', 'editor')
  ) then
    raise exception 'not_allowed';
  end if;

  insert into public.products (
    profile_id,
    section_id,
    category_id,
    name,
    brand,
    format,
    unit,
    stock_current,
    stock_min,
    stock_ideal,
    reference_price,
    last_price,
    location,
    image_url,
    active,
    catalog_product_id,
    created_by
  )
  select
    p_profile_id,
    cp.section_id,
    cp.category_id,
    cp.name,
    cp.brand,
    cp.format,
    cp.unit,
    0,
    null,
    null,
    cp.default_reference_price,
    null,
    null,
    null,
    true,
    cp.id,
    p_created_by
  from public.catalog_products cp
  where cp.active = true
    and not exists (
      select 1
      from public.products pr
      where pr.profile_id = p_profile_id
        and pr.catalog_product_id = cp.id
    );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.copy_catalog_products_to_profile(uuid, uuid) from public;
grant execute on function public.copy_catalog_products_to_profile(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Semilla inicial (idempotente por nombre + sección + categoría)
-- ---------------------------------------------------------------------------
insert into public.catalog_products (
  section_id,
  category_id,
  name,
  brand,
  format,
  unit,
  default_reference_price,
  sort_order,
  active
)
select s.id, c.id, v.name, v.brand, v.format, v.unit, v.default_reference_price, v.sort_order, true
from (
  values
    ('Despensa', 'General', 'Arroz 1 kg', null, 'bolsa 1 kg', 'unidad', 2500::numeric, 10),
    ('Despensa', 'General', 'Aceite vegetal 1 L', null, 'botella 1 L', 'unidad', 3500::numeric, 20),
    ('Despensa', 'General', 'Azúcar 1 kg', null, 'bolsa 1 kg', 'unidad', 1800::numeric, 30),
    ('Despensa', 'General', 'Sal fina 1 kg', null, 'bolsa 1 kg', 'unidad', 900::numeric, 40),
    ('Despensa', 'General', 'Fideos spaghetti 400 g', null, 'paquete', 'unidad', 1200::numeric, 50),
    ('Despensa', 'General', 'Atún en agua 170 g', null, 'lata', 'unidad', 1500::numeric, 60),
    ('Lácteos y refrigerados', 'General', 'Leche entera 1 L', null, 'brick 1 L', 'unidad', 1200::numeric, 70),
    ('Lácteos y refrigerados', 'General', 'Yogur natural 155 g', null, 'pote', 'unidad', 600::numeric, 80),
    ('Lácteos y refrigerados', 'General', 'Mantequilla con sal 125 g', null, 'bloque', 'unidad', 2000::numeric, 90),
    ('Lácteos y refrigerados', 'General', 'Huevos medianos', null, 'bandeja 12 u', 'bandeja', 3500::numeric, 100),
    ('Frutas y verduras', 'General', 'Papa', null, 'kg', 'kg', 800::numeric, 110),
    ('Frutas y verduras', 'General', 'Cebolla', null, 'kg', 'kg', 1200::numeric, 120),
    ('Frutas y verduras', 'General', 'Zanahoria', null, 'kg', 'kg', 1000::numeric, 130),
    ('Frutas y verduras', 'General', 'Tomate', null, 'kg', 'kg', 2000::numeric, 140),
    ('Frutas y verduras', 'General', 'Plátano', null, 'kg', 'kg', 1500::numeric, 150),
    ('Carnes y pescados', 'General', 'Pollo entero', null, 'kg', 'kg', 4500::numeric, 160),
    ('Carnes y pescados', 'General', 'Carne molida', null, 'kg', 'kg', 8000::numeric, 170),
    ('Panadería', 'General', 'Pan marraqueta', null, 'kg', 'kg', 2500::numeric, 180),
    ('Panadería', 'General', 'Pan de molde', null, 'paquete', 'unidad', 2200::numeric, 190),
    ('Bebidas', 'General', 'Agua mineral 1,5 L', null, 'botella', 'unidad', 1000::numeric, 200),
    ('Bebidas', 'General', 'Bebida cola 1,5 L', null, 'botella', 'unidad', 2500::numeric, 210),
    ('Aseo hogar', 'General', 'Detergente líquido 3 L', null, 'botella', 'unidad', 8000::numeric, 220),
    ('Aseo hogar', 'General', 'Lavavajillas 750 ml', null, 'botella', 'unidad', 3500::numeric, 230),
    ('Higiene personal', 'General', 'Papel higiénico doble hoja', null, 'pack 12 u', 'pack', 5000::numeric, 240),
    ('Higiene personal', 'General', 'Jabón líquido 250 ml', null, 'dispensador', 'unidad', 2500::numeric, 250),
    ('Congelados', 'General', 'Verduras mixtas congeladas 1 kg', null, 'bolsa 1 kg', 'unidad', 3500::numeric, 260),
    ('Mascotas', 'General', 'Alimento perro adulto 15 kg', null, 'bolsa', 'unidad', 45000::numeric, 270),
    ('Bebé', 'General', 'Pañales talla M', null, 'pack', 'pack', 12000::numeric, 280),
    ('Farmacia hogar', 'General', 'Paracetamol 500 mg 16 comprimidos', null, 'blister', 'unidad', 2500::numeric, 290),
    ('Otros', 'General', 'Pilas AA 4 unidades', null, 'blister', 'unidad', 3000::numeric, 300)
) as v(section_name, category_name, name, brand, format, unit, default_reference_price, sort_order)
join public.sections s on s.name = v.section_name
join public.categories c on c.section_id = s.id and c.name = v.category_name
where not exists (
  select 1
  from public.catalog_products cp
  where cp.name = v.name
    and cp.section_id = s.id
    and cp.category_id = c.id
);

-- Alias para emparejar texto de boletas (mismo nombre en minúsculas; sin duplicar)
insert into public.catalog_product_aliases (catalog_product_id, alias_normalized)
select cp.id, lower(trim(regexp_replace(cp.name, '\s+', ' ', 'g')))
from public.catalog_products cp
where cp.active = true
on conflict (catalog_product_id, alias_normalized) do nothing;
