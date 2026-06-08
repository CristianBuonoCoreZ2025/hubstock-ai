-- ============================================================================
-- HOMOLOGACION PASO 2 - MOTOR v3: JOIN directo con indice GIN
-- ============================================================================
-- Problema de las versiones anteriores:
--   v1/v2: iteran fila por fila (RBAR), ejecutan catalog_retail_match_candidates()
--          una vez por fila via LATERAL JOIN. Para 1000 filas = 1000+ consultas.
--   batch: mitigacion por lotes, sigue siendo LATERAL por fila dentro del lote.
--
-- Solucion v3:
--   Un solo JOIN masivo entre scrapping y catalog_products usando el indice GIN
--   existente: idx_catalog_products_name_search_norm_trgm
--   El operador '%' (similarity threshold) del indice GIN reduce de ~10.000
--   productos a ~50 candidatos por fila. ROW_NUMBER() rankea top 2.
--
-- Requisitos:
--   - Extension pg_trgm instalada
--   - Indice: idx_catalog_products_name_search_norm_trgm
--     ON catalog_products USING GIN (catalog_text_search_norm(name) gin_trgm_ops)
--   - Tablas: scrapping, catalog_products, categories, catalog_retail_links,
--             homologation_user_feedback, homologation_score_weights
-- ============================================================================

create or replace function public.scrapping_homologation_step2_compute_all_pending_v3()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_processed int := 0;
  v_auto int := 0;
  v_gray int := 0;
  v_new int := 0;
begin
  -- Guarda rapida: si el catalogo esta vacio, todo pending va directo a pending_new.
  if not exists (select 1 from public.catalog_products cp where coalesce(cp.active, true)) then
    update public.scrapping
    set
      base_score = 0,
      base_decision = 'NO_CATALOG',
      base_best_product_id = null,
      base_second_product_id = null,
      base_gap = 0,
      base_result = jsonb_build_object('reason', 'catalog_empty'),
      ai_required = false,
      homolog_final_status = 'PENDING_NEW',
      catalog_match_status = 'pending_new',
      matched_catalog_product_id = null,
      homolog_step2_computed_at = now()
    where catalog_match_status = 'pending';

    get diagnostics v_new = row_count;

    return jsonb_build_object(
      'processed', v_new,
      'auto_tentative_base', 0,
      'gray_ia_queued', 0,
      'pending_new', v_new
    );
  end if;

  -- ========================================================================
  -- PASO UNICO: JOIN directo con indice GIN + window functions
  -- ========================================================================
  -- 1. JOIN scrapping x catalog_products via GIN (%)
  --    El indice reduce de ~10.000 a ~50 productos candidatos por fila
  -- 2. ROW_NUMBER() rankea top 2 por fila en una sola pasada
  -- 3. UPDATE masivo con decisiones finales
  -- ========================================================================

  with
  -- Candidatos usando indice GIN (operador '%')
  candidates as (
    select
      s.id as sid,
      cp.id as cpid,
      cp.name as cpname,
      cp.brand as cpbrand,
      cp.category_id,
      cp.default_reference_price,
      cat.name as cat_name,
      -- Score de nombre (50% del score total)
      greatest(0, least(1, similarity(
        public.catalog_text_search_norm(s.product_name),
        public.catalog_text_search_norm(cp.name)
      )::numeric)) as name_score,
      -- Score de marca
      greatest(0, least(1, similarity(
        public.catalog_text_search_norm(coalesce(s.brand, '')),
        public.catalog_text_search_norm(coalesce(cp.brand, ''))
      )::numeric)) as brand_score,
      -- Score de precio
      case
        when cp.default_reference_price is not null and coalesce(s.price, 0) > 0 then
          greatest(0, least(1,
            (0.25::numeric - abs(cp.default_reference_price - s.price::numeric) / greatest(s.price::numeric, 1::numeric) * 0.25::numeric)
            / 0.25::numeric
          ))
        else 0.35::numeric
      end as price_score
    from public.scrapping s
    join public.catalog_products cp
      on cp.active = true
      and public.catalog_text_search_norm(cp.name) % public.catalog_text_search_norm(s.product_name)
    left join public.categories cat on cat.id = cp.category_id
    where s.catalog_match_status = 'pending'
  ),
  -- Score compuesto + rankeo por fila (top 2)
  scored as (
    select
      sid, cpid, cpname, brand_score, cat_name,
      name_score,
      greatest(0, least(1, name_score * 0.95::numeric)) as variant_score,
      greatest(0, least(1, name_score * 0.90::numeric)) as format_score,
      price_score,
      -- Score compuesto (mismos pesos que la version original)
      greatest(0, least(1,
        public.homologation_weight('name') * name_score
        + public.homologation_weight('variant') * greatest(0, least(1, name_score * 0.95::numeric))
        + public.homologation_weight('format') * greatest(0, least(1, name_score * 0.90::numeric))
        + public.homologation_weight('brand') * brand_score
        + public.homologation_weight('category') * 0.35::numeric
        + public.homologation_weight('price') * price_score
      )) as composite_score,
      row_number() over (
        partition by sid
        order by
          public.homologation_weight('name') * name_score
          + public.homologation_weight('variant') * greatest(0, least(1, name_score * 0.95::numeric))
          + public.homologation_weight('format') * greatest(0, least(1, name_score * 0.90::numeric))
          + public.homologation_weight('brand') * brand_score
          + public.homologation_weight('category') * 0.35::numeric
          + public.homologation_weight('price') * price_score
          desc
      ) as rn
    from candidates
  ),
  -- Top 1 (mejor candidato) por fila
  best as (
    select sid, cpid as best_id, name_score, brand_score, variant_score, format_score, price_score, composite_score as score1
    from scored where rn = 1
  ),
  -- Top 2 (segundo candidato) por fila
  second as (
    select sid, cpid as second_id, composite_score as score2
    from scored where rn = 2
  ),
  -- Feedback de usuario
  fb as (
    select
      s.id as sid,
      coalesce(sum(f.penalty_delta), 0::numeric) as adj
    from public.scrapping s
    left join public.homologation_user_feedback f
      on f.fingerprint = public.catalog_text_search_norm(trim(lower(s.product_name)))
    where s.catalog_match_status = 'pending'
    group by s.id
  ),
  -- Link boost
  lb as (
    select
      s.id as sid,
      case when exists (
        select 1 from public.catalog_retail_links lk
        where lower(trim(lk.retailer)) = lower(trim(s.retailer))
          and lk.external_ref = s.external_ref
          and lk.catalog_product_id = b.best_id
      ) then public.homologation_weight('LINK_BOOST') else 0::numeric end as link_boost
    from public.scrapping s
    join best b on b.sid = s.id
    where s.catalog_match_status = 'pending'
  ),
  -- Scores finales con feedback y link boost
  final_scores as (
    select
      b.sid,
      b.best_id,
      s.second_id,
      b.name_score, b.brand_score, b.variant_score, b.format_score, b.price_score,
      b.score1 + coalesce(lb.link_boost, 0) + public.homologation_weight('feedback') *
        greatest(0, least(1, 0.5::numeric + least(0.5::numeric, greatest(-0.5::numeric, coalesce(fb.adj, 0) / 20.0::numeric)))) as final_score1,
      coalesce(s.score2, 0::numeric) as final_score2,
      coalesce(lb.link_boost, 0) as link_boost_val,
      greatest(0, least(1, 0.5::numeric + least(0.5::numeric, greatest(-0.5::numeric, coalesce(fb.adj, 0) / 20.0::numeric)))) as feedback_val
    from best b
    left join second s on s.sid = b.sid
    left join fb on fb.sid = b.sid
    left join lb on lb.sid = b.sid
  ),
  -- Decisiones finales
  decisions as (
    select
      fs.*,
      greatest(0, fs.final_score1 - fs.final_score2) as gap,
      case
        when fs.name_score > 0.82::numeric and fs.brand_score < 0.12::numeric then 'HARD_CONFLICT'::text
        when (not (fs.name_score > 0.82::numeric and fs.brand_score < 0.12::numeric))
          and fs.final_score1 >= 0.90::numeric and greatest(0, fs.final_score1 - fs.final_score2) >= 0.08::numeric
        then 'AUTO_TENTATIVE'::text
        when fs.final_score1 < 0.70::numeric then 'PENDING_NEW_SCORE'::text
        when fs.final_score1 >= 0.70::numeric and fs.final_score1 < 0.90::numeric then 'GRAY_IA'::text
        else 'AMBIGUOUS_GAP'::text
      end as decision,
      case
        when fs.name_score > 0.82::numeric and fs.brand_score < 0.12::numeric then 'USER_REVIEW'::text
        when (not (fs.name_score > 0.82::numeric and fs.brand_score < 0.12::numeric))
          and fs.final_score1 >= 0.90::numeric and greatest(0, fs.final_score1 - fs.final_score2) >= 0.08::numeric
        then 'ACTIVE_TENTATIVE_BASE'::text
        when fs.final_score1 < 0.70::numeric then 'PENDING_NEW'::text
        else 'GRAY_IA_QUEUED'::text
      end as final_status
    from final_scores fs
  )
  -- UPDATE masivo
  update public.scrapping sc
  set
    base_score = d.final_score1,
    base_decision = d.decision,
    base_best_product_id = d.best_id,
    base_second_product_id = d.second_id,
    base_gap = d.gap,
    base_result = jsonb_build_object(
      'name_score', d.name_score,
      'variant_score', d.variant_score,
      'format_score', d.format_score,
      'brand_score', d.brand_score,
      'category_score', 0.35,
      'price_score', d.price_score,
      'feedback_score', d.feedback_val,
      'link_boost', d.link_boost_val,
      'hard_conflict', (d.name_score > 0.82::numeric and d.brand_score < 0.12::numeric)
    ),
    ai_required = (d.decision in ('GRAY_IA', 'AMBIGUOUS_GAP')),
    ai_score = null, ai_decision = null, ai_result = null,
    homolog_user_decision = null, homolog_reviewed_at = null,
    homolog_final_status = d.final_status,
    catalog_match_status = case
      when d.final_status = 'PENDING_NEW' then 'pending_new'
      when d.final_status = 'ACTIVE_TENTATIVE_BASE' then 'pending_homolog'
      when d.final_status = 'USER_REVIEW' then 'pending'
      when d.final_status = 'GRAY_IA_QUEUED' then 'pending'
      else sc.catalog_match_status
    end,
    matched_catalog_product_id = case
      when d.final_status = 'ACTIVE_TENTATIVE_BASE' then d.best_id
      when d.final_status = 'PENDING_NEW' then null
      else sc.matched_catalog_product_id
    end,
    homolog_step2_computed_at = now()
  from decisions d
  where sc.id = d.sid;

  -- Contar resultados
  select count(*) into v_processed from public.scrapping
  where catalog_match_status in ('pending_new', 'pending_homolog', 'pending')
    and homolog_step2_computed_at > now() - interval '1 minute';

  select count(*) into v_auto from public.scrapping
  where homolog_final_status = 'ACTIVE_TENTATIVE_BASE'
    and homolog_step2_computed_at > now() - interval '1 minute';

  select count(*) into v_gray from public.scrapping
  where homolog_final_status = 'GRAY_IA_QUEUED'
    and homolog_step2_computed_at > now() - interval '1 minute';

  select count(*) into v_new from public.scrapping
  where homolog_final_status = 'PENDING_NEW'
    and homolog_step2_computed_at > now() - interval '1 minute';

  return jsonb_build_object(
    'processed', v_processed, 'auto_tentative_base', v_auto,
    'gray_ia_queued', v_gray, 'pending_new', v_new
  );
end;
$$;

comment on function public.scrapping_homologation_step2_compute_all_pending_v3() is
  'Paso 2 motor DB v3: JOIN directo con indice GIN. Sin LATERAL JOINs. Un solo paso SQL.';

revoke all on function public.scrapping_homologation_step2_compute_all_pending_v3() from public;
grant execute on function public.scrapping_homologation_step2_compute_all_pending_v3() to service_role;
