-- -----------------------------------------------------------------------------
-- Conteos agrupados para grillas catálogo (se evita cargar todas las filas en el
-- cliente; PostgREST aplica techo efectivo sobre select sin GROUP BY).
-- -----------------------------------------------------------------------------

create or replace function public.catalog_product_counts_by_category_ids(
  p_category_ids uuid[],
  p_active_only boolean default true
)
returns table (
  category_id uuid,
  product_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select cp.category_id, count(*)::bigint as product_count
  from public.catalog_products cp
  where cp.category_id = any(coalesce(p_category_ids, '{}'::uuid[]))
    and (
      not p_active_only
      or cp.active = true
    )
  group by cp.category_id;
$$;

comment on function public.catalog_product_counts_by_category_ids(uuid[], boolean) is
  'Cuenta productos del catálogo maestro por categoría; respeta RLS del invocador.';

create or replace function public.catalog_product_counts_by_brand_ids(
  p_brand_ids uuid[],
  p_active_only boolean default true
)
returns table (
  brand_id uuid,
  product_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select cp.brand_id, count(*)::bigint as product_count
  from public.catalog_products cp
  where cp.brand_id is not null
    and cp.brand_id = any(coalesce(p_brand_ids, '{}'::uuid[]))
    and (
      not p_active_only
      or cp.active = true
    )
  group by cp.brand_id;
$$;

comment on function public.catalog_product_counts_by_brand_ids(uuid[], boolean) is
  'Cuenta productos del catálogo maestro por marca canónica; respeta RLS del invocador.';

grant execute on function public.catalog_product_counts_by_category_ids(uuid[], boolean) to authenticated;
grant execute on function public.catalog_product_counts_by_brand_ids(uuid[], boolean) to authenticated;
