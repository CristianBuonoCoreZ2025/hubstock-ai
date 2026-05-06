-- Esquemas antiguos pueden tener la columna como "quantity"; la app y stockcasa_core usan "delta".
-- Si solo existe quantity, al renombrar la app y PostgREST vuelven a alinearse.
do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'stock_movements'
      and c.column_name = 'quantity'
  )
  and not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'stock_movements'
      and c.column_name = 'delta'
  ) then
    alter table public.stock_movements rename column quantity to delta;
  end if;
end $$;

comment on column public.stock_movements.delta is 'Cambio de stock (+ entrada, − salida); antes puede haberse llamado quantity en BD legacy.';

-- Si coexistían quantity y delta: los inserts de la app solo llenaban delta → quantity quedaba null y fallaba el NOT NULL.
do $$
begin
  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'stock_movements' and c.column_name = 'quantity'
  )
  and exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'stock_movements' and c.column_name = 'delta'
  ) then
    update public.stock_movements
      set delta = quantity
      where delta is null and quantity is not null;
    alter table public.stock_movements drop column quantity;
  end if;
end $$;
