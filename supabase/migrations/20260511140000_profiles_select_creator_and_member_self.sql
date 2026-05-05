-- PostgREST/Supabase: INSERT ... RETURNING aplica políticas SELECT sobre la fila devuelta.
-- Sin estas políticas, crear perfil falla porque aún no eres miembro (is_profile_member = false).
-- Complementan las políticas existentes (en Postgres RLS permisivas se combinan con OR).

drop policy if exists "profiles_select_creator" on public.profiles;

create policy "profiles_select_creator"
  on public.profiles for select
  to authenticated
  using (created_by = auth.uid());

drop policy if exists "profile_members_select_own_user" on public.profile_members;

create policy "profile_members_select_own_user"
  on public.profile_members for select
  to authenticated
  using (user_id = auth.uid());
