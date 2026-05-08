-- Algunas bases tienen la FK como `purchase_receipt_id`; el código usa `receipt_id`.
-- 1) Si solo existe purchase_receipt_id → renombrar a receipt_id (coincide con RLS y app).
-- 2) Si coexisten ambas → rellenar y mantener sincronizado con trigger antes de INSERT/UPDATE.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipt_items'
      and column_name = 'purchase_receipt_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipt_items'
      and column_name = 'receipt_id'
  ) then
    alter table public.purchase_receipt_items
      rename column purchase_receipt_id to receipt_id;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipt_items'
      and column_name = 'purchase_receipt_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipt_items'
      and column_name = 'receipt_id'
  ) then
    execute '
      update public.purchase_receipt_items
      set purchase_receipt_id = receipt_id
      where receipt_id is not null
        and purchase_receipt_id is null
    ';
  end if;
end;
$$;

create or replace function public.purchase_receipt_items_sync_receipt_fk()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op not in ('INSERT', 'UPDATE') then
    return new;
  end if;
  if new.receipt_id is not null and new.purchase_receipt_id is null then
    new.purchase_receipt_id := new.receipt_id;
  elsif new.purchase_receipt_id is not null and new.receipt_id is null then
    new.receipt_id := new.purchase_receipt_id;
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipt_items'
      and column_name = 'purchase_receipt_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_receipt_items'
      and column_name = 'receipt_id'
  ) then
    drop trigger if exists trg_purchase_receipt_items_sync_receipt
      on public.purchase_receipt_items;
    create trigger trg_purchase_receipt_items_sync_receipt
      before insert or update on public.purchase_receipt_items
      for each row execute procedure public.purchase_receipt_items_sync_receipt_fk();
  end if;
end;
$$;

comment on function public.purchase_receipt_items_sync_receipt_fk() is
  'Si existen receipt_id y purchase_receipt_id, copia la FK entre ambas para inserts desde clientes que solo envían una.';
