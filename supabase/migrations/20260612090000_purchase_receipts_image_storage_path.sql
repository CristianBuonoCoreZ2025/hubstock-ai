-- Tablas creadas antes de stockcasa_core pueden existir sin esta columna;
-- PostgREST falla si el cliente inserta/lee image_storage_path y no está en BD.
alter table public.purchase_receipts
  add column if not exists image_storage_path text;

comment on column public.purchase_receipts.image_storage_path is
  'Ruta en Storage (p. ej. bucket boletas) de la imagen del ticket, si aplica.';
