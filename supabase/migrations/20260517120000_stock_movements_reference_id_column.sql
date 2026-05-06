-- Esquemas antiguos pueden tener stock_movements sin reference_id (boletas, chequeos enlazan aquí).
alter table public.stock_movements add column if not exists reference_id uuid;

comment on column public.stock_movements.reference_id is 'Referencia opcional al recurso origen (p. ej. purchase_receipts.id, stock_checks.id)';
