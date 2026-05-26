-- ============================================================================
-- Migracion: Formalizar el estado `paused` en scrapping_runs.
--
-- Contexto:
--   - `scrapping_runs.status` venia siendo text libre con valores
--     {'running','completed','cancelled'} sin CHECK constraint.
--   - "Detener" desde la UI ahora pausa la corrida (status='paused') en vez de
--     cancelarla, para permitir reanudar o terminar despues.
--   - Esta migracion documenta los 4 estados validos y agrega un CHECK constraint
--     que protege contra escrituras con valores invalidos.
--
-- Estados:
--   running   -> corrida en ejecucion (tiene workers procesando paginas)
--   paused    -> corrida pausada por el usuario; reanudable
--   completed -> corrida finalizada (cierre normal o "Terminar" forzado)
--   cancelled -> corrida cancelada para iniciar un barrido nuevo (fresh start)
--
-- Notas:
--   - `pending` NO se usa en scrapping_runs; ese valor solo aplica a
--     scrapping_pages (cola de URLs por pagina).
--   - El RPC get_barrido_context ya filtra `status != 'running'` para latest_run,
--     por lo que `paused` aparece como ultima corrida sin requerir cambios al RPC.
-- ============================================================================

-- 1) Documentar la columna
COMMENT ON COLUMN public.scrapping_runs.status IS
  'Estado del run: running (en ejecucion), paused (detenido manual, retomable), completed (finalizado), cancelled (cancelado para fresh start).';

-- 2) Normalizar valores inesperados antes del CHECK (defensivo, debe ser no-op
-- si el codigo siempre escribio uno de los 4 valores).
update public.scrapping_runs
set status = 'cancelled'
where status not in ('running', 'paused', 'completed', 'cancelled');

-- 3) Agregar CHECK constraint
alter table public.scrapping_runs
  drop constraint if exists scrapping_runs_status_check;

alter table public.scrapping_runs
  add constraint scrapping_runs_status_check
  check (status in ('running', 'paused', 'completed', 'cancelled'));

-- 4) Indice por status para acelerar:
--    - WHERE status = 'running' (cancelAllRunningScrappingRuns, RPC get_barrido_context)
--    - WHERE status != 'running' (RPC get_barrido_context para latest_run)
create index if not exists idx_scrapping_runs_status
  on public.scrapping_runs (status);

-- 5) Trazabilidad: registrar el cambio en app_changelog
insert into public.app_changelog (version, module, description, files_changed, author, tags, created_at) values
  ('1.0.011', 'scraping',
    'Estado paused formalizado en scrapping_runs (Detener pausa, no cancela). Reanudar y Terminar funcionan desde paused. CHECK constraint protege estados validos. Indice por status.',
    array[
      'supabase/migrations/20260703000500_scrapping_runs_paused_status.sql',
      'src/server/retail/scrapping/lider-scrapping-service.ts',
      'src/app/actions/retail-scrapping.ts',
      'src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx'
    ],
    'cursor', array['feature', 'sql', 'scraping', 'pause'],
    now())
on conflict (version) do nothing;
