-- Detalle por ítem del escaneo (marca, tipo, contenido neto, etc.)
alter table public.stock_check_detected_items
  add column if not exists brand_guess text,
  add column if not exists product_type_guess text,
  add column if not exists presentation_guess text,
  add column if not exists net_quantity numeric,
  add column if not exists net_unit text,
  add column if not exists notes text;

comment on column public.stock_check_detected_items.brand_guess is 'Marca inferida por IA';
comment on column public.stock_check_detected_items.product_type_guess is 'Tipo de producto (ej. leche, arroz)';
comment on column public.stock_check_detected_items.presentation_guess is 'Presentación del envase';
comment on column public.stock_check_detected_items.net_quantity is 'Contenido neto numérico';
comment on column public.stock_check_detected_items.net_unit is 'Unidad del contenido neto (g, ml, L)';
comment on column public.stock_check_detected_items.notes is 'Notas del modelo sobre el ítem';

