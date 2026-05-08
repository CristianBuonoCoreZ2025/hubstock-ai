-- RPC optimizada: búsqueda paginada de catálogo usando índices trgm sin armar haystack por fila.
-- Objetivo: 1 request por búsqueda en /catalog, manteniendo búsqueda tipo Google (multi-palabra, strict/loose).
--
-- Requisitos:
-- - public.catalog_text_search_norm(text) (ya existe en migraciones previas)
-- - pg_trgm + unaccent
-- - índices trgm sobre catalog_text_search_norm(name/brand/alias_normalized) o sobre columnas base

create extension if not exists pg_trgm;
create extension if not exists unaccent;

drop function if exists public.catalog_products_search_page_v2(
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

create function public.catalog_products_search_page_v2(
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
  with base as (
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
      public.catalog_text_search_norm(cp.name) as name_norm
    from public.catalog_products cp
    left join public.catalog_brands cb on cb.id = cp.brand_id
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
    select b.*
    from base b
    where not exists (
      select 1
      from generate_subscripts(p_terms_strict, 1) as idx
      where not (
        -- Producto / marca / presentación (cada campo normalizado por separado, indexable)
        public.catalog_text_search_norm(b.name) like '%' || p_terms_strict[idx] || '%'
        or public.catalog_text_search_norm(b.name) like '%' || p_terms_loose[idx] || '%'
        or public.catalog_text_search_norm(coalesce(b.brand, '')) like '%' || p_terms_strict[idx] || '%'
        or public.catalog_text_search_norm(coalesce(b.brand, '')) like '%' || p_terms_loose[idx] || '%'
        or public.catalog_text_search_norm(trim(coalesce(b.format, '') || ' ' || coalesce(b.unit, ''))) like '%' || p_terms_strict[idx] || '%'
        or public.catalog_text_search_norm(trim(coalesce(b.format, '') || ' ' || coalesce(b.unit, ''))) like '%' || p_terms_loose[idx] || '%'
        or public.catalog_text_search_norm(coalesce(b.brand_label, '')) like '%' || p_terms_strict[idx] || '%'
        or public.catalog_text_search_norm(coalesce(b.brand_label, '')) like '%' || p_terms_loose[idx] || '%'
        -- Alias sin agregación (EXISTS usa índices trgm + by_product si aplica)
        or exists (
          select 1
          from public.catalog_product_aliases a
          where a.catalog_product_id = b.id
            and (
              public.catalog_text_search_norm(a.alias_normalized) like '%' || p_terms_strict[idx] || '%'
              or public.catalog_text_search_norm(a.alias_normalized) like '%' || p_terms_loose[idx] || '%'
            )
        )
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
      when f.name_norm = p_full_norm then 0
      when f.name_norm like p_full_norm || '%' then 2
      when f.name_norm like '%' || p_full_norm || '%' then 5
      else 8
    end,
    lower(f.name) asc
  limit v_lim
  offset v_off;
end;
$$;

comment on function public.catalog_products_search_page_v2(
  text[], text[], text, uuid, uuid, uuid, boolean, integer, integer
) is
  'Lista paginada optimizada de catalog_products; evita haystack por fila y usa campos indexables + EXISTS en alias.';

grant execute on function public.catalog_products_search_page_v2(
  text[], text[], text, uuid, uuid, uuid, boolean, integer, integer
) to authenticated;

grant execute on function public.catalog_products_search_page_v2(
  text[], text[], text, uuid, uuid, uuid, boolean, integer, integer
) to service_role;

