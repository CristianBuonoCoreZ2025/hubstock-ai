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

-- Helpers internos para evitar recursión de RLS en profile_members.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_profile_member(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profile_members pm
    where pm.profile_id = p_profile_id
      and pm.user_id = auth.uid()
      and pm.status = 'active'
  );
$$;

create or replace function private.has_profile_role(
  p_profile_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profile_members pm
    where pm.profile_id = p_profile_id
      and pm.user_id = auth.uid()
      and pm.status = 'active'
      and pm.role = any(allowed_roles)
  );
$$;

revoke all on function private.is_profile_member(uuid) from public;
revoke all on function private.has_profile_role(uuid, text[]) from public;
grant execute on function private.is_profile_member(uuid) to authenticated, service_role;
grant execute on function private.has_profile_role(uuid, text[]) to authenticated, service_role;

-- Exposición explícita para Supabase Data API (PostgREST).
grant select, insert, update, delete on
  public.profiles,
  public.profile_members,
  public.invitations,
  public.products,
  public.product_images,
  public.stock_movements,
  public.shopping_trips,
  public.shopping_trip_items,
  public.purchase_receipts,
  public.purchase_receipt_items,
  public.stock_checks,
  public.stock_check_photos,
  public.stock_check_detected_items
to authenticated;

grant select on public.sections, public.categories to authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Helper: miembro activo de un perfil
-- profiles
drop policy if exists "profiles_select_member" on public.profiles;
create policy "profiles_select_member"
  on public.profiles for select
  to authenticated
  using (private.is_profile_member(id));

drop policy if exists "profiles_insert_authenticated" on public.profiles;
create policy "profiles_insert_authenticated"
  on public.profiles for insert
  to authenticated
  with check (
    auth.uid() is not null
    and created_by = auth.uid()
  );

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using (private.has_profile_role(id, array['admin']))
  with check (private.has_profile_role(id, array['admin']));

-- profile_members
drop policy if exists "profile_members_select_same_profile" on public.profile_members;
create policy "profile_members_select_same_profile"
  on public.profile_members for select
  to authenticated
  using (private.is_profile_member(profile_id));

drop policy if exists "profile_members_insert_admin" on public.profile_members;
create policy "profile_members_insert_admin"
  on public.profile_members for insert
  to authenticated
  with check (private.has_profile_role(profile_id, array['admin']));

drop policy if exists "profile_members_update_admin" on public.profile_members;
create policy "profile_members_update_admin"
  on public.profile_members for update
  to authenticated
  using (private.has_profile_role(profile_id, array['admin']))
  with check (private.has_profile_role(profile_id, array['admin']));

drop policy if exists "profile_members_delete_admin" on public.profile_members;
create policy "profile_members_delete_admin"
  on public.profile_members for delete
  to authenticated
  using (private.has_profile_role(profile_id, array['admin']));

-- invitations (solo admin)
drop policy if exists "invitations_select_admin" on public.invitations;
create policy "invitations_select_admin"
  on public.invitations for select
  to authenticated
  using (private.has_profile_role(profile_id, array['admin']));

drop policy if exists "invitations_write_admin" on public.invitations;
create policy "invitations_write_admin"
  on public.invitations for all
  to authenticated
  using (private.has_profile_role(profile_id, array['admin']))
  with check (private.has_profile_role(profile_id, array['admin']));

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
  with check (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = stock_checks.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
    and created_by = auth.uid()
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

-- Permisos explícitos para Supabase Data API.
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
