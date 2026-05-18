-- Agrega columna image_url a la tabla scrapping para almacenar la miniatura capturada
-- durante el barrido VTEX (items[0].images[0].imageUrl).
-- El upsert tiene fallback gracioso: si la columna no existe aún, reintenta sin ella.

alter table public.scrapping
  add column if not exists image_url text;

comment on column public.scrapping.image_url is
  'URL de miniatura capturada del retailer durante el barrido (VTEX: items[0].images[0].imageUrl). Null si no disponible en el momento de la captura.';
