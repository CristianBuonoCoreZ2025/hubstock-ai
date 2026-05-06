-- Resuelve marca por la misma regla que idx_catalog_brands_name_lower_unique.
-- Evita cargar toda la tabla en el servidor y fallos al guardar varios ítems de captura con la misma marca.

create or replace function public.catalog_brand_id_for_label(p_name text)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select id
  from public.catalog_brands
  where lower(trim(name)) = lower(trim(p_name))
  limit 1;
$$;

comment on function public.catalog_brand_id_for_label(text) is
  'Lookup de marca alineado al índice único lower(trim(name)); captura / ensure brand.';

grant execute on function public.catalog_brand_id_for_label(text) to authenticated;
grant execute on function public.catalog_brand_id_for_label(text) to service_role;
