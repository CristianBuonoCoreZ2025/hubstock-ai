-- Bandejas de revisión masiva Lider + contadores de snapshots (precio igual no inserta fila nueva).

alter table public.retail_capture_batches
  add column if not exists pipeline_phase text not null default 'capture',
  add column if not exists snapshot_inserted_total int not null default 0,
  add column if not exists snapshot_skipped_same_price_total int not null default 0;

comment on column public.retail_capture_batches.pipeline_phase is
  'capture | processing | review | closed — flujo operativo UI Lider.';

alter table public.retail_captured_products
  add column if not exists review_tray text,
  add column if not exists group_key text,
  add column if not exists suggested_master_id uuid references public.catalog_products (id) on delete set null;

comment on column public.retail_captured_products.review_tray is
  'Bandeja de excepción para agrupar revisión masiva (solo filas no resueltas automáticamente).';

comment on column public.retail_captured_products.group_key is
  'Clave estable para agrupar ítems con la misma decisión sugerida en UI.';

create index if not exists idx_retail_captured_products_batch_tray_group
  on public.retail_captured_products (batch_id, review_tray, group_key)
  where review_tray is not null;

-- Valores permitidos de bandeja (validación en app; aquí solo documentación).

-- Datos existentes: clasificación mínima para no dejar bandeja nula.
update public.retail_captured_products
set review_tray = 'duplicate_risk'
where status = 'duplicate_risk' and review_tray is null;

update public.retail_captured_products
set review_tray = 'low_confidence'
where status = 'review' and review_tray is null;

update public.retail_captured_products
set group_key = id::text
where group_key is null and status in ('review', 'duplicate_risk');

-- Agregación de grupos para UI (evita traer miles de filas al cliente).
create or replace function public.retail_lider_review_groups_for_batch(p_batch_id uuid)
returns table (
  review_tray text,
  group_key text,
  suggested_master_id uuid,
  suggested_master_name text,
  product_count bigint,
  avg_confidence numeric,
  sample_titles text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.review_tray,
    p.group_key,
    p.suggested_master_id,
    max(cp.name) as suggested_master_name,
    count(*)::bigint as product_count,
    avg(p.decision_confidence) as avg_confidence,
    coalesce(
      (array_agg(p.title order by p.created_at desc))[1:5],
      array[]::text[]
    ) as sample_titles
  from public.retail_captured_products p
  left join public.catalog_products cp on cp.id = p.suggested_master_id
  where p.batch_id = p_batch_id
    and p.status in ('review', 'duplicate_risk')
    and p.review_tray is not null
    and p.group_key is not null
  group by p.review_tray, p.group_key, p.suggested_master_id;
$$;

comment on function public.retail_lider_review_groups_for_batch(uuid) is
  'Resumen de bandejas de revisión masiva Lider por lote (conteos, muestra de títulos).';

grant execute on function public.retail_lider_review_groups_for_batch(uuid) to authenticated;
grant execute on function public.retail_lider_review_groups_for_batch(uuid) to service_role;
