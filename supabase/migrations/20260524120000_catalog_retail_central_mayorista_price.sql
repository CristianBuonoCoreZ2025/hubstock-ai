-- Añade precio último de Central Mayorista (retailer = central_mayorista) a la RPC existente.

create or replace function public.catalog_retail_prices_for_products(p_product_ids uuid[])
returns table (
  catalog_product_id uuid,
  retail_price_lider numeric,
  retail_price_jumbo numeric,
  retail_price_central_mayorista numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    u.id as catalog_product_id,
    (
      select s.price
      from public.catalog_retail_links lk
      inner join public.catalog_retail_snapshots s
        on s.retailer = lk.retailer and s.external_ref = lk.external_ref
      where lk.catalog_product_id = u.id
        and lk.retailer = 'lider'
      order by s.captured_at desc
      limit 1
    ) as retail_price_lider,
    (
      select s.price
      from public.catalog_retail_links lk
      inner join public.catalog_retail_snapshots s
        on s.retailer = lk.retailer and s.external_ref = lk.external_ref
      where lk.catalog_product_id = u.id
        and lk.retailer = 'jumbo'
      order by s.captured_at desc
      limit 1
    ) as retail_price_jumbo,
    (
      select s.price
      from public.catalog_retail_links lk
      inner join public.catalog_retail_snapshots s
        on s.retailer = lk.retailer and s.external_ref = lk.external_ref
      where lk.catalog_product_id = u.id
        and lk.retailer = 'central_mayorista'
      order by s.captured_at desc
      limit 1
    ) as retail_price_central_mayorista
  from unnest(p_product_ids) as u(id);
$$;

comment on function public.catalog_retail_prices_for_products(uuid[]) is
  'Último precio por cadena (lider, jumbo, central_mayorista) para maestros con vínculo en catalog_retail_links.';

grant execute on function public.catalog_retail_prices_for_products(uuid[]) to authenticated;
grant execute on function public.catalog_retail_prices_for_products(uuid[]) to service_role;
