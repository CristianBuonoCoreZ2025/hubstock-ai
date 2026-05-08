-- Legado: algunas BD tienen purchase_date NOT NULL mientras la app usa solo purchased_at (nullable).
-- Unifica con stockcasa_core y permite borradores sin fecha.

do $$
begin
  -- A) Solo purchase_date → renombrar a purchased_at y permitir null en borradores.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipts' and column_name = 'purchase_date'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipts' and column_name = 'purchased_at'
  ) then
    alter table public.purchase_receipts rename column purchase_date to purchased_at;
    alter table public.purchase_receipts alter column purchased_at drop not null;
  -- B) Ambas columnas: consolidar en purchased_at y quitar duplicado.
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipts' and column_name = 'purchase_date'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipts' and column_name = 'purchased_at'
  ) then
    update public.purchase_receipts
    set purchased_at = coalesce(purchased_at, purchase_date);
    alter table public.purchase_receipts drop column purchase_date;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipts' and column_name = 'purchased_at'
  ) then
    alter table public.purchase_receipts alter column purchased_at drop not null;
  end if;
end $$;
