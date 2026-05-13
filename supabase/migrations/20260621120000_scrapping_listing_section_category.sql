-- Segmentos de ruta inferidos desde listing_url (por retail) + columnas en scrapping.

alter table public.retail
  add column if not exists listing_url_path_config jsonb;

comment on column public.retail.listing_url_path_config is
  'JSON por retail: índices 0-based en segmentos de pathname (sin vacíos) para rellenar scrapping.sections y scrapping.categories. Ej. Lider: section=1, category=2 en /browse/marcas-propias/limpieza-hogar/...';

update public.retail
set listing_url_path_config = jsonb_build_object(
  'listingPathSegmentIndices',
  jsonb_build_object('section', 1, 'category', 2)
)
where lower(name) = 'lider'
  and listing_url_path_config is null;

alter table public.scrapping
  add column if not exists sections text;

alter table public.scrapping
  add column if not exists categories text;

comment on column public.scrapping.sections is
  'Segmento de URL de listado inferido (p. ej. marcas-propias); regla en retail.listing_url_path_config.';

comment on column public.scrapping.categories is
  'Segmento de URL de listado inferido (p. ej. limpieza-hogar); regla en retail.listing_url_path_config.';
