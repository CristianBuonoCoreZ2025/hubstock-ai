-- Cola de páginas de captura Lider (una petición HTTP por fila; reanudable, tolerante a fallos por página).

create table if not exists public.retail_capture_pages (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.retail_capture_batches (id) on delete cascade,
  retailer text not null default 'lider',
  page_url text not null,
  page_index int not null,
  status text not null default 'pending',
  products_found int not null default 0,
  clean_products int not null default 0,
  discarded_products int not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.retail_capture_pages is
  'Cola de páginas de captura retail: pending → processing → done | failed | skipped.';

create unique index if not exists uq_retail_capture_pages_batch_page_index
  on public.retail_capture_pages (batch_id, page_index);

create index if not exists idx_retail_capture_pages_batch_status
  on public.retail_capture_pages (batch_id, status);

alter table public.retail_capture_batches
  add column if not exists capture_discarded_total int not null default 0;

comment on column public.retail_capture_batches.capture_discarded_total is
  'Acumulado de ítems descartados en captura (datos incompletos o basura).';

alter table public.retail_capture_pages enable row level security;

drop policy if exists "retail_capture_pages_select_authenticated" on public.retail_capture_pages;
create policy "retail_capture_pages_select_authenticated"
  on public.retail_capture_pages for select
  to authenticated
  using (true);

grant select, insert, update, delete, references, trigger on table public.retail_capture_pages to service_role;
