-- Marca canónica para productos propios de cadena en frescos/pan (comparativo entre retailers).

insert into public.catalog_brands (name)
select 'Marca genérica'
where not exists (
  select 1
  from public.catalog_brands b
  where lower(trim(b.name)) = lower(trim('Marca genérica'))
);
