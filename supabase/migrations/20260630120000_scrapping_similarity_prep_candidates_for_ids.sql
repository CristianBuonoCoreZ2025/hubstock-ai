-- Paso 2 masivo: un solo round-trip Postgres para candidatos RPC de muchas filas pending.
-- El servidor aplica filtro marca/precio compuesto y decisiones en TypeScript (rápido en memoria).

create or replace function public.scrapping_similarity_prep_candidates_for_ids(p_ids uuid[])
returns table (
  scrapping_id uuid,
  retailer text,
  external_ref text,
  product_name text,
  brand text,
  price numeric,
  sections text,
  categories text,
  rpc_candidates jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with pend as (
    select
      s.id,
      s.retailer,
      s.external_ref,
      s.product_name,
      s.brand,
      s.price::numeric as price_num,
      s.sections,
      s.categories
    from public.scrapping s
    where
      s.catalog_match_status = 'pending'
      and s.id = any(coalesce(p_ids, array[]::uuid[]))
  ),
  expanded as (
    select
      p.id as scrapping_id,
      p.retailer,
      p.external_ref,
      p.product_name,
      p.brand,
      p.price_num as price,
      p.sections,
      p.categories,
      c.catalog_product_id,
      c.product_name as cand_product_name,
      c.category_id,
      c.default_reference_price,
      c.match_score,
      cp.brand as catalog_brand
    from pend p
    cross join lateral public.catalog_retail_match_candidates(
      trim(
        concat_ws(
          ' ',
          nullif(trim(p.product_name), ''),
          nullif(trim(p.sections), ''),
          nullif(trim(p.categories), '')
        )
      ),
      case
        when p.price_num is not null and p.price_num > 0 then p.price_num
        else null::numeric
      end,
      null::uuid,
      40
    ) as c
    inner join public.catalog_products cp
      on cp.id = c.catalog_product_id
      and cp.active = true
  ),
  agg as (
    select
      e.scrapping_id,
      jsonb_agg(
        jsonb_build_object(
          'catalog_product_id', e.catalog_product_id,
          'product_name', e.cand_product_name,
          'category_id', e.category_id,
          'default_reference_price', e.default_reference_price,
          'match_score', e.match_score,
          'catalog_brand', e.catalog_brand
        )
        order by e.match_score desc
      ) as rpc_candidates
    from expanded e
    group by e.scrapping_id
  )
  select
    p.id as scrapping_id,
    p.retailer,
    p.external_ref,
    p.product_name,
    p.brand,
    p.price_num as price,
    p.sections,
    p.categories,
    coalesce(a.rpc_candidates, '[]'::jsonb) as rpc_candidates
  from pend p
  left join agg a on a.scrapping_id = p.id;
$$;

comment on function public.scrapping_similarity_prep_candidates_for_ids(uuid[]) is
  'Devuelve candidatos catalog_retail_match_candidates + marca maestro por lote de scrapping.id (pending). Invocar con service_role desde servidor.';

revoke all on function public.scrapping_similarity_prep_candidates_for_ids(uuid[]) from public;
grant execute on function public.scrapping_similarity_prep_candidates_for_ids(uuid[]) to service_role;
