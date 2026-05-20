-- Dashboard de homologacion: 4 conteos en una sola query interna.
-- Reemplaza 4 peticiones HTTP POSTgREST (count exact) por una sola RPC.
-- Los conteos usan indices parciales existentes cuando esten disponibles.

create or replace function public.scrapping_homologation_dashboard()
returns table (
  pending_any bigint,
  gray_ia_queued bigint,
  user_review bigint,
  pending_new bigint
)
language sql
stable
security definer
as $$
  select
    (select count(*) from public.scrapping where catalog_match_status = 'pending'),
    (select count(*) from public.scrapping where homolog_final_status = 'GRAY_IA_QUEUED' and coalesce(ai_required, false) = true),
    (select count(*) from public.scrapping where homolog_final_status = 'USER_REVIEW'),
    (select count(*) from public.scrapping where catalog_match_status = 'pending_new');
$$;

comment on function public.scrapping_homologation_dashboard() is
  'Devuelve 4 conteos de scrapping para el dashboard de homologacion en una sola query.';
