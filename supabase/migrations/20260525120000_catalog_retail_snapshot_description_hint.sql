-- Texto largo opcional del retailer para comparar novedad vs maestro (scrapers).

alter table public.catalog_retail_snapshots
  add column if not exists description_hint text;

comment on column public.catalog_retail_snapshots.description_hint is
  'Descripción corta u observación del retailer (p. ej. descripcion_corta en SQLite) para comparar similitud al homologar o decidir alta de maestro.';
