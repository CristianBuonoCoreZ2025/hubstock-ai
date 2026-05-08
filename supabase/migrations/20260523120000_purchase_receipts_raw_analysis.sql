-- Desalineación con stockcasa_core: tablas antiguas pueden no tener raw_analysis.
alter table public.purchase_receipts
  add column if not exists raw_analysis jsonb;

comment on column public.purchase_receipts.raw_analysis is
  'Payload JSON del análisis de IA (boleta) antes de confirmar; auditoría y reintentos.';
