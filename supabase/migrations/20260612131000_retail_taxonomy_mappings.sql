-- Mapeo de taxonomía externa (Lider) al catálogo maestro (sections / categories).

create table if not exists public.retail_taxonomy_mappings (
  id uuid primary key default gen_random_uuid(),
  retailer text not null,
  external_section text not null default '',
  external_category text not null default '',
  normalized_external_section text not null,
  normalized_external_category text not null,
  section_id uuid references public.sections (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'linked', 'suggested', 'missing', 'ignored')),
  match_method text,
  confidence numeric,
  products_count int not null default 0,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (retailer, normalized_external_section, normalized_external_category)
);

comment on table public.retail_taxonomy_mappings is
  'Homologación de sección/categoría de tienda retail contra sections/categories del catálogo maestro.';

create index if not exists idx_retail_taxonomy_mappings_retailer_status
  on public.retail_taxonomy_mappings (retailer, status);

create index if not exists idx_retail_taxonomy_mappings_retailer_section_norm
  on public.retail_taxonomy_mappings (retailer, normalized_external_section);

drop trigger if exists set_retail_taxonomy_mappings_updated_at on public.retail_taxonomy_mappings;
create trigger set_retail_taxonomy_mappings_updated_at
  before update on public.retail_taxonomy_mappings
  for each row execute function public.set_updated_at();

alter table public.retail_taxonomy_mappings enable row level security;

drop policy if exists "retail_taxonomy_mappings_select_authenticated" on public.retail_taxonomy_mappings;
create policy "retail_taxonomy_mappings_select_authenticated"
  on public.retail_taxonomy_mappings for select
  to authenticated
  using (true);
