-- Captura masiva de productos retail en tabla `scrapping` (análisis posterior; sin taxonomía).
-- Cola por ejecución: scrapping_runs + scrapping_pages; filas de producto en public.scrapping.

create table if not exists public.scrapping_runs (
  id uuid primary key default gen_random_uuid(),
  retailer text not null default 'lider',
  source_chain text not null default 'lider',
  status text not null default 'running',
  total_pages int,
  pages_done int not null default 0,
  rows_inserted bigint not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.scrapping_runs is
  'Ejecución de captura «scrapping» por cadena (p. ej. Lider): control de cola y totales.';

create index if not exists idx_scrapping_runs_started
  on public.scrapping_runs (started_at desc);

create table if not exists public.scrapping_pages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.scrapping_runs (id) on delete cascade,
  retailer text not null default 'lider',
  page_url text not null,
  page_index int not null,
  status text not null default 'pending',
  products_found int not null default 0,
  rows_written int not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.scrapping_pages is
  'Cola de URLs de listado a procesar por ejecución scrapping (pending → processing → done | failed).';

create unique index if not exists uq_scrapping_pages_run_page_index
  on public.scrapping_pages (run_id, page_index);

create index if not exists idx_scrapping_pages_run_status
  on public.scrapping_pages (run_id, status);

create table if not exists public.scrapping (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.scrapping_runs (id) on delete cascade,
  retailer text not null default 'lider',
  external_ref text not null,
  product_url text not null,
  product_name text not null,
  brand text,
  price numeric not null,
  currency text not null default 'CLP',
  source_chain text not null default 'lider',
  listing_url text not null,
  extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id, retailer, external_ref)
);

comment on table public.scrapping is
  'Filas de producto capturadas por scraping (URL completa, nombre, marca, precio, cadena, fecha de extracción).';

create index if not exists idx_scrapping_run_extracted
  on public.scrapping (run_id, extracted_at desc);

create index if not exists idx_scrapping_product_url
  on public.scrapping (product_url);

alter table public.scrapping_runs enable row level security;
alter table public.scrapping_pages enable row level security;
alter table public.scrapping enable row level security;

drop policy if exists "scrapping_runs_select_authenticated" on public.scrapping_runs;
create policy "scrapping_runs_select_authenticated"
  on public.scrapping_runs for select
  to authenticated
  using (true);

drop policy if exists "scrapping_pages_select_authenticated" on public.scrapping_pages;
create policy "scrapping_pages_select_authenticated"
  on public.scrapping_pages for select
  to authenticated
  using (true);

drop policy if exists "scrapping_select_authenticated" on public.scrapping;
create policy "scrapping_select_authenticated"
  on public.scrapping for select
  to authenticated
  using (true);

grant select, insert, update, delete, references, trigger on table public.scrapping_runs to service_role;
grant select, insert, update, delete, references, trigger on table public.scrapping_pages to service_role;
grant select, insert, update, delete, references, trigger on table public.scrapping to service_role;
