-- Pipeline de captura retail por lotes (Lider primero): staging + homologación + snapshots.

create table if not exists public.retail_capture_batches (
  id uuid primary key default gen_random_uuid(),
  retailer text not null,
  status text not null default 'running',
  current_page int not null default 0,
  total_pages int,
  total_found int not null default 0,
  total_inserted int not null default 0,
  url_linked int not null default 0,
  exact_linked int not null default 0,
  rule_linked int not null default 0,
  ai_linked int not null default 0,
  new_master_created int not null default 0,
  review_required int not null default 0,
  duplicate_risk int not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.retail_capture_batches is
  'Control de captura retail por páginas (Vercel); contadores de homologación por lote.';

create index if not exists idx_retail_capture_batches_retailer_started
  on public.retail_capture_batches (retailer, started_at desc);

create table if not exists public.retail_captured_products (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.retail_capture_batches (id) on delete cascade,
  retailer text not null,
  external_ref text not null,
  source_url text,
  title text not null,
  normalized_title text not null,
  brand text,
  normalized_brand text,
  price numeric,
  unit_price text,
  category_hint text,
  description_hint text,
  image_url text,
  raw_data jsonb,
  status text not null default 'pending',
  catalog_product_id uuid references public.catalog_products (id) on delete set null,
  decision_source text,
  decision_confidence numeric,
  decision_reason text,
  created_at timestamptz not null default now(),
  unique (batch_id, retailer, external_ref)
);

comment on table public.retail_captured_products is
  'Productos capturados en staging antes/durante homologación al catálogo maestro.';

create index if not exists idx_retail_captured_products_batch_status
  on public.retail_captured_products (batch_id, status);

create index if not exists idx_retail_captured_products_retailer_ref
  on public.retail_captured_products (retailer, external_ref);

create table if not exists public.retail_ai_match_reviews (
  id uuid primary key default gen_random_uuid(),
  captured_product_id uuid not null references public.retail_captured_products (id) on delete cascade,
  retailer text not null,
  title text not null,
  brand text,
  price numeric,
  suggested_catalog_product_id uuid references public.catalog_products (id) on delete set null,
  decision text not null,
  confidence numeric,
  reason text,
  candidates jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.retail_ai_match_reviews is
  'Registro de decisiones de IA o revisión para homologación retail ambigua.';

create index if not exists idx_retail_ai_match_reviews_captured
  on public.retail_ai_match_reviews (captured_product_id, created_at desc);

alter table public.retail_capture_batches enable row level security;
alter table public.retail_captured_products enable row level security;
alter table public.retail_ai_match_reviews enable row level security;

drop policy if exists "retail_capture_batches_select_authenticated" on public.retail_capture_batches;
create policy "retail_capture_batches_select_authenticated"
  on public.retail_capture_batches for select
  to authenticated
  using (true);

drop policy if exists "retail_captured_products_select_authenticated" on public.retail_captured_products;
create policy "retail_captured_products_select_authenticated"
  on public.retail_captured_products for select
  to authenticated
  using (true);

drop policy if exists "retail_ai_match_reviews_select_authenticated" on public.retail_ai_match_reviews;
create policy "retail_ai_match_reviews_select_authenticated"
  on public.retail_ai_match_reviews for select
  to authenticated
  using (true);
