-- Reparación: RPC accept_pending_invitations_for_current_user usa i.expires_at;
-- en algunos entornos la columna no existía (drift respecto a stockcasa_core).

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name = 'expires_at'
  ) then
    alter table public.invitations
      add column expires_at timestamptz;

    update public.invitations
    set expires_at = coalesce(created_at, now()) + interval '7 days'
    where expires_at is null;

    alter table public.invitations
      alter column expires_at set not null;
  end if;
end
$$;

comment on column public.invitations.expires_at is
  'Caducidad de la invitación; usada por accept_pending_invitations_for_current_user.';
