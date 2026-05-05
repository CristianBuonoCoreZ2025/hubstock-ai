-- Hogares adicionales para una misma invitación (correo + rol + token).
-- El ancla sigue siendo invitations.profile_id (perfil activo al crear).

create table if not exists public.invitation_targets (
  invitation_id uuid not null references public.invitations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invitation_id, profile_id)
);

create index if not exists idx_invitation_targets_profile_id
  on public.invitation_targets (profile_id);

alter table public.invitation_targets enable row level security;

grant select, insert, delete on public.invitation_targets to authenticated;

-- Ver: administrador del ancla de la invitación O del hogar enlazado
drop policy if exists invitation_targets_select_admin on public.invitation_targets;

create policy invitation_targets_select_admin
  on public.invitation_targets for select
  to authenticated
  using (
    exists (
      select 1
      from public.invitations inv
      join public.profile_members pm
        on pm.profile_id = inv.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
      where inv.id = invitation_targets.invitation_id
    )
    or exists (
      select 1
      from public.profile_members pm
      where pm.profile_id = invitation_targets.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  );

drop policy if exists invitation_targets_insert_admin on public.invitation_targets;

create policy invitation_targets_insert_admin
  on public.invitation_targets for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.invitations inv
      join public.profile_members pm
        on pm.profile_id = inv.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
      where inv.id = invitation_targets.invitation_id
    )
    and exists (
      select 1
      from public.profile_members pm
      where pm.profile_id = invitation_targets.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  );

drop policy if exists invitation_targets_delete_admin on public.invitation_targets;

create policy invitation_targets_delete_admin
  on public.invitation_targets for delete
  to authenticated
  using (
    exists (
      select 1
      from public.invitations inv
      join public.profile_members pm
        on pm.profile_id = inv.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
      where inv.id = invitation_targets.invitation_id
    )
    and exists (
      select 1
      from public.profile_members pm
      where pm.profile_id = invitation_targets.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'admin'
    )
  );

create or replace function public.accept_pending_invitations_for_current_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.profile_members (profile_id, user_id, role, status)
  select distinct tgt.profile_id, auth.uid(), i.role, 'active'
  from public.invitations i
  inner join auth.users u on u.id = auth.uid() and lower(u.email) = lower(i.email)
  inner join lateral (
    select i.profile_id as profile_id
    union
    select it.profile_id
    from public.invitation_targets it
    where it.invitation_id = i.id
  ) tgt on true
  where i.status = 'pending'
    and i.expires_at > now()
  on conflict (profile_id, user_id) do update
    set
      status = 'active',
      role = excluded.role,
      updated_at = now();

  update public.invitations i
  set status = 'accepted'
  from auth.users u
  where u.id = auth.uid()
    and lower(i.email) = lower(u.email)
    and i.status = 'pending'
    and exists (
      select 1
      from public.profile_members pm
      where pm.profile_id = i.profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    );
end;
$$;
