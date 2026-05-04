-- Repara bases existentes con recursión en RLS de profile_members
-- y agrega permisos explícitos para Supabase Data API.

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

alter table public.profiles enable row level security;
alter table public.profile_members enable row level security;
alter table public.invitations enable row level security;

drop policy if exists "profiles_select_member" on public.profiles;
drop policy if exists profiles_select_policy on public.profiles;
create policy "profiles_select_member"
  on public.profiles for select
  to authenticated
  using (private.is_profile_member(id));

drop policy if exists "profiles_insert_authenticated" on public.profiles;
drop policy if exists profiles_insert_policy on public.profiles;
create policy "profiles_insert_authenticated"
  on public.profiles for insert
  to authenticated
  with check (
    auth.uid() is not null
    and created_by = auth.uid()
  );

drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists profiles_update_policy on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using (private.has_profile_role(id, array['admin']))
  with check (private.has_profile_role(id, array['admin']));

drop policy if exists "profiles_delete_admin" on public.profiles;
drop policy if exists profiles_delete_policy on public.profiles;
create policy "profiles_delete_admin"
  on public.profiles for delete
  to authenticated
  using (private.has_profile_role(id, array['admin']));

drop policy if exists "profile_members_select_same_profile" on public.profile_members;
drop policy if exists profile_members_select_policy on public.profile_members;
create policy "profile_members_select_same_profile"
  on public.profile_members for select
  to authenticated
  using (private.is_profile_member(profile_id));

drop policy if exists "profile_members_insert_admin" on public.profile_members;
drop policy if exists profile_members_insert_policy on public.profile_members;
create policy "profile_members_insert_admin"
  on public.profile_members for insert
  to authenticated
  with check (private.has_profile_role(profile_id, array['admin']));

drop policy if exists "profile_members_update_admin" on public.profile_members;
drop policy if exists profile_members_update_policy on public.profile_members;
create policy "profile_members_update_admin"
  on public.profile_members for update
  to authenticated
  using (private.has_profile_role(profile_id, array['admin']))
  with check (private.has_profile_role(profile_id, array['admin']));

drop policy if exists "profile_members_delete_admin" on public.profile_members;
drop policy if exists profile_members_delete_policy on public.profile_members;
create policy "profile_members_delete_admin"
  on public.profile_members for delete
  to authenticated
  using (private.has_profile_role(profile_id, array['admin']));

drop policy if exists "invitations_select_admin" on public.invitations;
drop policy if exists invitations_select_policy on public.invitations;
create policy "invitations_select_admin"
  on public.invitations for select
  to authenticated
  using (private.has_profile_role(profile_id, array['admin']));

drop policy if exists "invitations_write_admin" on public.invitations;
drop policy if exists invitations_insert_policy on public.invitations;
drop policy if exists invitations_update_policy on public.invitations;
drop policy if exists invitations_delete_policy on public.invitations;
create policy "invitations_write_admin"
  on public.invitations for all
  to authenticated
  using (private.has_profile_role(profile_id, array['admin']))
  with check (private.has_profile_role(profile_id, array['admin']));

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
