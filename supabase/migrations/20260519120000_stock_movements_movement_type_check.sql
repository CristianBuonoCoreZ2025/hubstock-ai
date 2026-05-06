-- Esquemas legacy pueden tener otro CHECK en movement_type (sin 'import', sinésimos en español, etc.).
-- La app solo usa los valores de MovementType en src/types/database.ts y stockcasa_core.
do $$
declare
  cname text;
begin
  for cname in
    select c.conname::text
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'stock_movements'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%movement_type%'
  loop
    execute format('alter table public.stock_movements drop constraint %I', cname);
  end loop;
end $$;

-- Alinear filas existentes a los únicos tipos soportados por la app.
update public.stock_movements
set movement_type = 'adjustment'
where movement_type not in (
  'consumption',
  'purchase',
  'adjustment',
  'import',
  'inventory_count'
);

alter table public.stock_movements
  add constraint stock_movements_movement_type_check
  check (
    movement_type in (
      'consumption',
      'purchase',
      'adjustment',
      'import',
      'inventory_count'
    )
  );

comment on column public.stock_movements.movement_type is
  'Tipo de movimiento: consumption, purchase, adjustment, import, inventory_count (valores fijos de la app).';
