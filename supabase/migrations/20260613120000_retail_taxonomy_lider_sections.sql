-- Secciones Lider detectadas (fase 1); categorías siguen en retail_taxonomy_mappings con FK opcional.

create table if not exists public.retail_taxonomy_lider_sections (
  id uuid primary key default gen_random_uuid(),
  retailer text not null default 'lider',
  external_section text not null,
  normalized_external_section text not null,
  source text,
  source_url text,
  products_count int not null default 0,
  sample_urls jsonb not null default '[]'::jsonb,
  sample_product_titles jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'linked', 'suggested', 'missing', 'ignored', 'discarded')),
  section_id uuid references public.sections (id) on delete set null,
  confidence numeric,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (retailer, normalized_external_section)
);

comment on table public.retail_taxonomy_lider_sections is
  'Secciones detectadas en Lider (fase 1) antes de categorías; vínculo opcional a public.sections.';

create index if not exists idx_retail_taxonomy_lider_sections_retailer_status
  on public.retail_taxonomy_lider_sections (retailer, status);

drop trigger if exists set_retail_taxonomy_lider_sections_updated_at on public.retail_taxonomy_lider_sections;
create trigger set_retail_taxonomy_lider_sections_updated_at
  before update on public.retail_taxonomy_lider_sections
  for each row execute function public.set_updated_at();

alter table public.retail_taxonomy_lider_sections enable row level security;

drop policy if exists "retail_taxonomy_lider_sections_select_authenticated" on public.retail_taxonomy_lider_sections;
create policy "retail_taxonomy_lider_sections_select_authenticated"
  on public.retail_taxonomy_lider_sections for select
  to authenticated
  using (true);

-- FK categorías → sección Lider (nullable hasta migrar datos legacy)
alter table public.retail_taxonomy_mappings
  add column if not exists lider_section_id uuid references public.retail_taxonomy_lider_sections (id) on delete cascade;

create index if not exists idx_retail_taxonomy_mappings_lider_section
  on public.retail_taxonomy_mappings (lider_section_id)
  where lider_section_id is not null;

-- Mapeos Lider previos sin sección explícita: limpiar para evitar colisión con el nuevo modelo por sección.
delete from public.retail_taxonomy_mappings where retailer = 'lider';

-- Quitar unicidad global (retailer, sección, categoría) para permitir la misma categoría bajo distintas secciones Lider.
do $dropu$
declare
  cname text;
begin
  for cname in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'retail_taxonomy_mappings'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%normalized_external_section%'
      and pg_get_constraintdef(c.oid) ilike '%normalized_external_category%'
  loop
    execute format('alter table public.retail_taxonomy_mappings drop constraint %I', cname);
  end loop;
end;
$dropu$;

drop index if exists public.uniq_retail_taxonomy_mapping_lider_section_cat;
create unique index uniq_retail_taxonomy_mapping_lider_section_cat
  on public.retail_taxonomy_mappings (retailer, lider_section_id, normalized_external_category)
  where retailer = 'lider' and lider_section_id is not null;
