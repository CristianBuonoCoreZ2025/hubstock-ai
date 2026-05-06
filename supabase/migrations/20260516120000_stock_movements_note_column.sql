-- Bases creadas fuera del orden de migraciones o sin la tabla completa pueden carecer de `note`.
-- La app y stockcasa_core usan stock_movements.note para texto libre e idempotencia (boletas).
alter table public.stock_movements add column if not exists note text;

comment on column public.stock_movements.note is 'Descripción del movimiento (consumo, import, compra, etc.)';
