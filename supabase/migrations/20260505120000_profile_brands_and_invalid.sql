-- Marcas guardadas por hogar (autocompletado en corrección de chequeos)
create table if not exists public.profile_brands (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint profile_brands_profile_name_unique unique (profile_id, name)
);

create index if not exists idx_profile_brands_profile on public.profile_brands (profile_id);

alter table public.profile_brands enable row level security;

drop policy if exists "profile_brands_select_member" on public.profile_brands;
create policy "profile_brands_select_member"
  on public.profile_brands for select
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = profile_brands.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "profile_brands_write_editor" on public.profile_brands;
create policy "profile_brands_write_editor"
  on public.profile_brands for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = profile_brands.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

drop policy if exists "profile_brands_delete_editor" on public.profile_brands;
create policy "profile_brands_delete_editor"
  on public.profile_brands for delete
  using (
    exists (
      select 1 from public.profile_members pm
      where pm.profile_id = profile_brands.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );

-- Ítem marcado como lectura errónea (no se aplica al inventario)
alter table public.stock_check_detected_items
  add column if not exists marked_invalid boolean not null default false;

comment on column public.stock_check_detected_items.marked_invalid is 'true = descartar línea (lectura incorrecta)';
