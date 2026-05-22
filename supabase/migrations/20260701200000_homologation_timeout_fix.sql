-- Wrapper para ejecutar el motor de homologacion paso 2 con statement_timeout extendido.
-- El motor original itera fila por fila y puede exceder el timeout por defecto de Supabase.

-- Opcion 1: wrapper explicito con SET LOCAL (mas seguro)
create or replace function public.scrapping_homologation_step2_compute_all_pending_safe()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  set local statement_timeout = '120000'; -- 120 segundos
  select public.scrapping_homologation_step2_compute_all_pending() into v_result;
  return v_result;
end;
$$;

comment on function public.scrapping_homologation_step2_compute_all_pending_safe() is
  'Paso 2 motor DB con timeout extendido a 120s. Wrapper seguro para evitar cancelacion en batches grandes.';

revoke all on function public.scrapping_homologation_step2_compute_all_pending_safe() from public;
grant execute on function public.scrapping_homologation_step2_compute_all_pending_safe() to service_role;
