-- Corrige INSERT en stock_checks: en WITH CHECK la fila nueva debe referenciarse
-- por nombre de columna (profile_id), no como stock_checks.profile_id, para que
-- la política coincida con lo que inserta el cliente autenticado.
-- Además se limita explícitamente al rol authenticated.

drop policy if exists "stock_checks_write_editor" on public.stock_checks;

create policy "stock_checks_write_editor"
  on public.stock_checks
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.profile_members pm
      where pm.profile_id = profile_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('admin', 'editor')
    )
  );
