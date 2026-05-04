-- StockCasa AI: esquema base (historial migraciones CLI).
-- Para una base nueva desde cero, prefiera los scripts modulares en la carpeta
-- supabase/ (schema-01-core.sql … schema-05-rls.sql o schema-all.sql).
-- Ejecutar en Supabase SQL Editor o con: supabase db push (con CLI vinculado)

-- ---------------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tablas core (perfiles y membresía)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profile_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  status text not null default 'active' check (status in ('active', 'inactive', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, user_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  token text not null unique,
  expires_at timestamptz not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catálogo: secciones y categorías (globales, orden de compra)
-- ---------------------------------------------------------------------------
create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  name text not null,
  brand text,
  format text,
  unit text,
  stock_current numeric not null default 0,
  stock_min numeric,
  stock_ideal numeric,
  reference_price numeric,
  last_price numeric,
  location text,
  image_url text,
  active boolean not null default true,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  delta numeric not null,
  movement_type text not null check (
    movement_type in ('consumption', 'purchase', 'adjustment', 'import', 'inventory_count')
  ),
  note text,
  reference_id uuid,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.shopping_trips (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  store_name text,
  notes text,
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists public.shopping_trip_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.shopping_trips (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity_planned numeric not null default 0,
  quantity_bought numeric,
  unit_price_paid numeric,
  is_checked boolean not null default false,
  sort_order int not null default 0,
  unique (trip_id, product_id)
);

create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  store_name text,
  purchased_at timestamptz,
  total numeric,
  image_storage_path text,
  raw_analysis jsonb,
  status text not null default 'pending_review' check (status in ('pending_review', 'confirmed', 'rejected')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  name_raw text not null,
  quantity numeric,
  unit_price numeric,
  line_total numeric,
  sort_order int not null default 0
);

create table if not exists public.stock_checks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  zone text not null,
  status text not null default 'draft' check (
    status in ('draft', 'processing', 'awaiting_confirmation', 'completed')
  ),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_check_photos (
  id uuid primary key default gen_random_uuid(),
  stock_check_id uuid not null references public.stock_checks (id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_check_detected_items (
  id uuid primary key default gen_random_uuid(),
  stock_check_id uuid not null references public.stock_checks (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  name_guess text not null,
  quantity_guess numeric,
  confidence numeric,
  accepted boolean,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Índices frecuentes
-- ---------------------------------------------------------------------------
create index if not exists idx_profile_members_user on public.profile_members (user_id);
create index if not exists idx_profile_members_profile on public.profile_members (profile_id);
create index if not exists idx_products_profile on public.products (profile_id);
create index if not exists idx_stock_movements_profile on public.stock_movements (profile_id);
create index if not exists idx_shopping_trips_profile on public.shopping_trips (profile_id);
create index if not exists idx_purchase_receipts_profile on public.purchase_receipts (profile_id);
create index if not exists idx_stock_checks_profile on public.stock_checks (profile_id);

-- ---------------------------------------------------------------------------
-- Triggers: membresía admin al crear perfil y updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile_members (profile_id, user_id, role, status)
  values (new.id, auth.uid(), 'admin', 'active');
  return new;
end;
$$;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_profile_members_updated_at on public.profile_members;
create trigger set_profile_members_updated_at
  before update on public.profile_members
  for each row execute function public.set_updated_at();

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists set_shopping_trips_updated_at on public.shopping_trips;
create trigger set_shopping_trips_updated_at
  before update on public.shopping_trips
  for each row execute function public.set_updated_at();

drop trigger if exists set_purchase_receipts_updated_at on public.purchase_receipts;
create trigger set_purchase_receipts_updated_at
  before update on public.purchase_receipts
  for each row execute function public.set_updated_at();

drop trigger if exists set_stock_checks_updated_at on public.stock_checks;
create trigger set_stock_checks_updated_at
  before update on public.stock_checks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: secciones y categoría "General" por sección (idempotente por nombre)
-- ---------------------------------------------------------------------------
insert into public.sections (name, sort_order)
select v.name, v.sort_order
from (
  values
    ('Frutas y verduras', 10),
    ('Carnes y pescados', 20),
    ('Lácteos y refrigerados', 30),
    ('Congelados', 40),
    ('Despensa', 50),
    ('Panadería', 60),
    ('Bebidas', 70),
    ('Aseo hogar', 80),
    ('Higiene personal', 90),
    ('Mascotas', 100),
    ('Bebé', 110),
    ('Farmacia hogar', 120),
    ('Otros', 130)
) as v(name, sort_order)
where not exists (
  select 1 from public.sections s where s.name = v.name
);

insert into public.categories (section_id, name, sort_order)
select s.id, 'General', 0
from public.sections s
where s.name in (
  'Frutas y verduras','Carnes y pescados','Lácteos y refrigerados','Congelados',
  'Despensa','Panadería','Bebidas','Aseo hogar','Higiene personal','Mascotas',
  'Bebé','Farmacia hogar','Otros'
)
and not exists (
  select 1 from public.categories c where c.section_id = s.id and c.name = 'General'
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profile_members enable row level security;
alter table public.invitations enable row level security;
alter table public.sections enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.stock_movements enable row level security;
alter table public.shopping_trips enable row level security;
alter table public.shopping_trip_items enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_items enable row level security;
alter table public.stock_checks enable row level security;
alter table public.stock_check_photos enable row level security;
alter table public.stock_check_detected_items enable row level security;

-- Helper: miembro activo de un perfil
-- profiles
drop policy if exists "profiles_select_member" on public.profiles;
create policy "profiles_select_member"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = profiles.id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "profiles_insert_authenticated" on public.profiles;
create policy "profiles_insert_authenticated"
  on public.profiles for insert
  with check (
    auth.uid() is not null
    and created_by = auth.uid()
  );

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = profiles.id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  );

-- profile_members
drop policy if exists "profile_members_select_same_profile" on public.profile_members;
create policy "profile_members_select_same_profile"
  on public.profile_members for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = profile_members.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "profile_members_insert_admin" on public.profile_members;
create policy "profile_members_insert_admin"
  on public.profile_members for insert
  with check (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = profile_members.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  );

drop policy if exists "profile_members_update_admin" on public.profile_members;
create policy "profile_members_update_admin"
  on public.profile_members for update
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = profile_members.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  );

-- invitations (solo admin)
drop policy if exists "invitations_select_admin" on public.invitations;
create policy "invitations_select_admin"
  on public.invitations for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = invitations.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  );

drop policy if exists "invitations_write_admin" on public.invitations;
create policy "invitations_write_admin"
  on public.invitations for all
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = invitations.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = invitations.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  );

-- Catálogo global: lectura autenticada, sin escritura desde cliente (opcional: solo service_role en migraciones)
drop policy if exists "sections_select_authenticated" on public.sections;
create policy "sections_select_authenticated"
  on public.sections for select
  to authenticated
  using (true);

drop policy if exists "categories_select_authenticated" on public.categories;
create policy "categories_select_authenticated"
  on public.categories for select
  to authenticated
  using (true);

-- products
drop policy if exists "products_select_member" on public.products;
create policy "products_select_member"
  on public.products for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = products.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "products_insert_editor" on public.products;
create policy "products_insert_editor"
  on public.products for insert
  with check (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = products.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
    and created_by = auth.uid()
  );

drop policy if exists "products_update_editor" on public.products;
create policy "products_update_editor"
  on public.products for update
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = products.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "products_delete_admin" on public.products;
create policy "products_delete_admin"
  on public.products for delete
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = products.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  );

-- product_images (lectura: miembros; alta/edición: admin/editor)
drop policy if exists "product_images_select_member" on public.product_images;
create policy "product_images_select_member"
  on public.product_images for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = product_images.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "product_images_insert_editor" on public.product_images;
create policy "product_images_insert_editor"
  on public.product_images for insert
  with check (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = product_images.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
    and created_by = auth.uid()
  );

drop policy if exists "product_images_update_editor" on public.product_images;
create policy "product_images_update_editor"
  on public.product_images for update
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = product_images.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "product_images_delete_editor" on public.product_images;
create policy "product_images_delete_editor"
  on public.product_images for delete
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = product_images.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

-- stock_movements
drop policy if exists "stock_movements_select_member" on public.stock_movements;
create policy "stock_movements_select_member"
  on public.stock_movements for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = stock_movements.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "stock_movements_insert_editor" on public.stock_movements;
create policy "stock_movements_insert_editor"
  on public.stock_movements for insert
  with check (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = stock_movements.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
    and created_by = auth.uid()
  );

-- shopping_trips / items (lectura: todos los miembros; escritura: admin/editor)
drop policy if exists "shopping_trips_select_member" on public.shopping_trips;
create policy "shopping_trips_select_member"
  on public.shopping_trips for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = shopping_trips.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "shopping_trips_insert_editor" on public.shopping_trips;
create policy "shopping_trips_insert_editor"
  on public.shopping_trips for insert
  with check (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = shopping_trips.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
    and created_by = auth.uid()
  );

drop policy if exists "shopping_trips_update_editor" on public.shopping_trips;
create policy "shopping_trips_update_editor"
  on public.shopping_trips for update
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = shopping_trips.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "shopping_trips_delete_editor" on public.shopping_trips;
create policy "shopping_trips_delete_editor"
  on public.shopping_trips for delete
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = shopping_trips.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "shopping_trip_items_select_member" on public.shopping_trip_items;
create policy "shopping_trip_items_select_member"
  on public.shopping_trip_items for select
  using (
    exists (
      select 1
      from public.shopping_trips t
      join public.profile_members pm on pm.profile_id = t.profile_id
      where t.id = shopping_trip_items.trip_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "shopping_trip_items_write_editor" on public.shopping_trip_items;
create policy "shopping_trip_items_write_editor"
  on public.shopping_trip_items for insert
  with check (
    exists (
      select 1
      from public.shopping_trips t
      join public.profile_members pm on pm.profile_id = t.profile_id
      where t.id = shopping_trip_items.trip_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "shopping_trip_items_update_editor" on public.shopping_trip_items;
create policy "shopping_trip_items_update_editor"
  on public.shopping_trip_items for update
  using (
    exists (
      select 1
      from public.shopping_trips t
      join public.profile_members pm on pm.profile_id = t.profile_id
      where t.id = shopping_trip_items.trip_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "shopping_trip_items_delete_editor" on public.shopping_trip_items;
create policy "shopping_trip_items_delete_editor"
  on public.shopping_trip_items for delete
  using (
    exists (
      select 1
      from public.shopping_trips t
      join public.profile_members pm on pm.profile_id = t.profile_id
      where t.id = shopping_trip_items.trip_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

-- receipts (lectura: miembros; escritura: admin/editor)
drop policy if exists "purchase_receipts_select_member" on public.purchase_receipts;
create policy "purchase_receipts_select_member"
  on public.purchase_receipts for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = purchase_receipts.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "purchase_receipts_insert_editor" on public.purchase_receipts;
create policy "purchase_receipts_insert_editor"
  on public.purchase_receipts for insert
  with check (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = purchase_receipts.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
    and created_by = auth.uid()
  );

drop policy if exists "purchase_receipts_update_editor" on public.purchase_receipts;
create policy "purchase_receipts_update_editor"
  on public.purchase_receipts for update
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = purchase_receipts.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "purchase_receipts_delete_editor" on public.purchase_receipts;
create policy "purchase_receipts_delete_editor"
  on public.purchase_receipts for delete
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = purchase_receipts.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "purchase_receipt_items_select_member" on public.purchase_receipt_items;
create policy "purchase_receipt_items_select_member"
  on public.purchase_receipt_items for select
  using (
    exists (
      select 1
      from public.purchase_receipts r
      join public.profile_members pm on pm.profile_id = r.profile_id
      where r.id = purchase_receipt_items.receipt_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "purchase_receipt_items_write_editor" on public.purchase_receipt_items;
create policy "purchase_receipt_items_write_editor"
  on public.purchase_receipt_items for insert
  with check (
    exists (
      select 1
      from public.purchase_receipts r
      join public.profile_members pm on pm.profile_id = r.profile_id
      where r.id = purchase_receipt_items.receipt_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "purchase_receipt_items_update_editor" on public.purchase_receipt_items;
create policy "purchase_receipt_items_update_editor"
  on public.purchase_receipt_items for update
  using (
    exists (
      select 1
      from public.purchase_receipts r
      join public.profile_members pm on pm.profile_id = r.profile_id
      where r.id = purchase_receipt_items.receipt_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "purchase_receipt_items_delete_editor" on public.purchase_receipt_items;
create policy "purchase_receipt_items_delete_editor"
  on public.purchase_receipt_items for delete
  using (
    exists (
      select 1
      from public.purchase_receipts r
      join public.profile_members pm on pm.profile_id = r.profile_id
      where r.id = purchase_receipt_items.receipt_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

-- stock_checks
drop policy if exists "stock_checks_select_member" on public.stock_checks;
create policy "stock_checks_select_member"
  on public.stock_checks for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = stock_checks.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "stock_checks_write_editor" on public.stock_checks;
create policy "stock_checks_write_editor"
  on public.stock_checks for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.profile_members pm
      where pm.profile_id = profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "stock_checks_update_editor" on public.stock_checks;
create policy "stock_checks_update_editor"
  on public.stock_checks for update
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = stock_checks.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "stock_check_photos_via_check" on public.stock_check_photos;
create policy "stock_check_photos_via_check"
  on public.stock_check_photos for all
  using (
    exists (
      select 1
      from public.stock_checks sc
      join public.profile_members pm on pm.profile_id = sc.profile_id
      where sc.id = stock_check_photos.stock_check_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  )
  with check (
    exists (
      select 1
      from public.stock_checks sc
      join public.profile_members pm on pm.profile_id = sc.profile_id
      where sc.id = stock_check_photos.stock_check_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "stock_check_detected_via_check" on public.stock_check_detected_items;
create policy "stock_check_detected_via_check"
  on public.stock_check_detected_items for all
  using (
    exists (
      select 1
      from public.stock_checks sc
      join public.profile_members pm on pm.profile_id = sc.profile_id
      where sc.id = stock_check_detected_items.stock_check_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  )
  with check (
    exists (
      select 1
      from public.stock_checks sc
      join public.profile_members pm on pm.profile_id = sc.profile_id
      where sc.id = stock_check_detected_items.stock_check_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

-- Nota: en proyectos Supabase, el rol `authenticated` suele tener permisos por defecto.
-- Si alguna tabla nueva no responde en el cliente, revisa Data API y GRANT en el panel.
