-- Optimiza `catalog_products_search_page`: un solo cálculo de haystack por fila (CTE) en lugar de
-- repetir `catalog_text_search_norm(...)` varias veces; mismo resultado que la versión anterior.
-- Índice en alias por producto para el lateral `where a.catalog_product_id = cp.id`.
--
-- Nota: Postgres puede rechazar `CREATE OR REPLACE` sobre funciones `RETURNS TABLE` si el catálogo
-- considera distinto el tipo de salida; por eso se hace DROP explícito y se recrean los GRANT.

create index if not exists idx_catalog_product_aliases_by_product
  on public.catalog_product_aliases (catalog_product_id);

drop function if exists public.catalog_products_search_page(
  text[],
  text[],
  text,
  uuid,
  uuid,
  uuid,
  boolean,
  integer,
  integer
);

create function public.catalog_products_search_page(
  p_terms_strict text[],
  p_terms_loose text[],
  p_full_norm text,
  p_section_id uuid,
  p_category_id uuid,
  p_brand_filter_id uuid,
  p_include_inactive boolean,
  p_page integer,
  p_page_size integer
)
returns table (
  id uuid,
  name text,
  brand text,
  brand_id uuid,
  format text,
  unit text,
  default_reference_price numeric,
  sort_order integer,
  active boolean,
  section_id uuid,
  category_id uuid,
  thumb_url text,
  brand_label text,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_off int;
  v_lim int;
begin
  if p_terms_strict is null or coalesce(array_length(p_terms_strict, 1), 0) < 1 then
    raise exception 'p_terms_strict must not be empty';
  end if;

  if coalesce(array_length(p_terms_loose, 1), 0) <> array_length(p_terms_strict, 1) then
    raise exception 'p_terms_loose length must match p_terms_strict';
  end if;

  v_lim := greatest(coalesce(p_page_size, 100), 1);
  v_off := greatest(coalesce(p_page, 0), 0) * v_lim;

  return query
  with hay as (
    select
      cp.id,
      cp.name,
      cp.brand,
      cp.brand_id,
      cp.format,
      cp.unit,
      cp.default_reference_price,
      cp.sort_order,
      cp.active,
      cp.section_id,
      cp.category_id,
      thumb.public_url as thumb_url,
      cb.name as brand_label,
      public.catalog_text_search_norm(
        cp.name || ' ' ||
        coalesce(cp.brand, '') || ' ' ||
        coalesce(cb.name, '') || ' ' ||
        coalesce(s.name, '') || ' ' ||
        coalesce(cat.name, '') || ' ' ||
        trim(coalesce(cp.format, '') || ' ' || coalesce(cp.unit, '')) || ' ' ||
        coalesce(al.agg, '')
      ) as haystack
    from public.catalog_products cp
    left join public.catalog_brands cb on cb.id = cp.brand_id
    inner join public.sections s on s.id = cp.section_id
    inner join public.categories cat on cat.id = cp.category_id
    left join lateral (
      select string_agg(a.alias_normalized, ' ') as agg
      from public.catalog_product_aliases a
      where a.catalog_product_id = cp.id
    ) al on true
    left join lateral (
      select m.public_url
      from public.catalog_product_media m
      where m.catalog_product_id = cp.id and m.kind = 'thumbnail'
      limit 1
    ) thumb on true
    where (p_include_inactive or cp.active = true)
      and (p_section_id is null or cp.section_id = p_section_id)
      and (p_category_id is null or cp.category_id = p_category_id)
      and (p_brand_filter_id is null or cp.brand_id = p_brand_filter_id)
  ),
  filtered as (
    select h.*
    from hay h
    where not exists (
      select 1
      from generate_subscripts(p_terms_strict, 1) as idx
      where not (
        h.haystack like '%' || p_terms_strict[idx] || '%'
        or h.haystack like '%' || p_terms_loose[idx] || '%'
      )
    )
  ),
  counted as (
    select count(*)::bigint as c from filtered
  )
  select
    f.id,
    f.name,
    f.brand,
    f.brand_id,
    f.format,
    f.unit,
    f.default_reference_price,
    f.sort_order,
    f.active,
    f.section_id,
    f.category_id,
    f.thumb_url,
    f.brand_label,
    (select c from counted)
  from filtered f
  order by
    case
      when public.catalog_text_search_norm(f.name) = p_full_norm then 0
      when public.catalog_text_search_norm(f.name) like p_full_norm || '%' then 2
      when public.catalog_text_search_norm(f.name) like '%' || p_full_norm || '%' then 5
      else 8
    end,
    lower(f.name) asc
  limit v_lim
  offset v_off;
end;
$$;

comment on function public.catalog_products_search_page(
  text[], text[], text, uuid, uuid, uuid, boolean, integer, integer
) is
  'Lista paginada de catalog_products; haystack normalizado una vez por fila (CTE).';

grant execute on function public.catalog_products_search_page(
  text[], text[], text, uuid, uuid, uuid, boolean, integer, integer
) to authenticated;

grant execute on function public.catalog_products_search_page(
  text[], text[], text, uuid, uuid, uuid, boolean, integer, integer
) to service_role;
