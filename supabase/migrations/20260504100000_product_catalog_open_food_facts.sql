-- Catálogo: GTIN y enriquecimiento (Open Food Facts) en productos y líneas de boleta
-- Aplicar en Supabase: supabase db push / SQL Editor. Datos OFF: https://openfoodfacts.org/terms-of-use

alter table public.products
  add column if not exists gtin text,
  add column if not exists enrichment_source text,
  add column if not exists enrichment_synced_at timestamptz;

alter table public.products
  drop constraint if exists products_enrichment_source_check;

alter table public.products
  add constraint products_enrichment_source_check
  check (enrichment_source is null or enrichment_source in ('open_food_facts', 'manual'));

create unique index if not exists idx_products_profile_gtin_unique
  on public.products (profile_id, gtin)
  where gtin is not null;

alter table public.purchase_receipt_items
  add column if not exists gtin text,
  add column if not exists enrichment jsonb;

create index if not exists idx_purchase_receipt_items_gtin
  on public.purchase_receipt_items (gtin)
  where gtin is not null;
