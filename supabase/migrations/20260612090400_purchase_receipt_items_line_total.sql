-- Alineación con stockcasa_core: líneas de boleta pueden tener total por ítem.
-- Si la tabla ya existía sin esta columna, PostgREST falla con "Could not find column ... in schema cache".

alter table public.purchase_receipt_items
  add column if not exists line_total numeric;
