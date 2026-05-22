-- Guarda: si el catalogo esta vacio, evita iterar fila por fila sobre miles de registros.

create or replace function public.scrapping_homologation_step2_compute_all_pending()
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
  r record;
  v_search text;
  v_price numeric;
  c1 record;
  c2 record;
  v_name1 numeric;
  v_name2 numeric;
  v_brand1 numeric;
  v_brand2 numeric;
  v_cat1 numeric;
  v_cat2 numeric;
  v_price1 numeric;
  v_price2 numeric;
  v_var1 numeric;
  v_var2 numeric;
  v_fmt1 numeric;
  v_fmt2 numeric;
  v_fb numeric;
  v_link_boost numeric;
  v_penalty numeric;
  v_hard boolean;
  v_score1 numeric;
  v_score2 numeric;
  v_gap numeric;
  v_base numeric;
  v_best uuid;
  v_second uuid;
  v_fingerprint text;
  v_feedback_adj numeric;
  v_row jsonb;
  v_decision text;
  v_final text;
  v_ai_req boolean;
  v_auto_ok boolean;
begin
  -- Guarda rapida: si el catalogo esta vacio, todo pending va directo a pending_new.
  -- Evita iterar fila por fila sobre miles de registros sin candidatos posibles.
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

  for r in
    select s.id, s.retailer, s.external_ref, s.product_name, s.brand, s.price::numeric as price_num,
           s.sections, s.categories
    from public.scrapping s
    where s.catalog_match_status = 'pending'
    order by s.id
  loop
    v_processed := v_processed + 1;
    v_search :=
      trim(
        concat_ws(
          ' ',
          nullif(trim(r.product_name), ''),
          nullif(trim(r.sections), ''),
          nullif(trim(r.categories), '')
        )
      );
    v_price := case when r.price_num is not null and r.price_num > 0 then r.price_num else null::numeric end;

    select m.catalog_product_id, m.match_score, m.product_name, m.category_id, m.default_reference_price
      into c1
    from public.catalog_retail_match_candidates(v_search, v_price, null::uuid, 12) m
    inner join public.catalog_products cp on cp.id = m.catalog_product_id and coalesce(cp.active, true)
    order by m.match_score desc
    limit 1;

    if c1.catalog_product_id is null then
      update public.scrapping s
      set
        base_score = 0,
        base_decision = 'NO_CANDIDATES',
        base_best_product_id = null,
        base_second_product_id = null,
        base_gap = 0,
        base_result = jsonb_build_object('reason', 'no_candidates'),
        ai_required = false,
        homolog_final_status = 'PENDING_NEW',
        catalog_match_status = 'pending_new',
        matched_catalog_product_id = null,
        homolog_step2_computed_at = now()
      where s.id = r.id;
      v_new := v_new + 1;
      continue;
    end if;

    select m.catalog_product_id, m.match_score
      into c2
    from public.catalog_retail_match_candidates(v_search, v_price, null::uuid, 12) m
    inner join public.catalog_products cp on cp.id = m.catalog_product_id and coalesce(cp.active, true)
    where m.catalog_product_id <> c1.catalog_product_id
    order by m.match_score desc
    limit 1;

    select
      greatest(0::numeric, least(1::numeric, similarity(
        public.catalog_text_search_norm(r.product_name),
        public.catalog_text_search_norm(cp.name)
      )::numeric)),
      greatest(0::numeric, least(1::numeric, similarity(
        public.catalog_text_search_norm(coalesce(r.brand, '')),
        public.catalog_text_search_norm(coalesce(cp.brand, ''))
      )::numeric)),
      case
        when cat.id is null then 0.35::numeric
        else greatest(0::numeric, least(1::numeric, similarity(
          public.catalog_text_search_norm(trim(coalesce(r.sections, '') || ' ' || coalesce(r.categories, ''))),
          public.catalog_text_search_norm(coalesce(cat.name, ''))
        )::numeric))
      end,
      case
        when cp.default_reference_price is not null and coalesce(v_price, 0) > 0 then
          greatest(
            0::numeric,
            least(
              1::numeric,
              (
                0.25::numeric
                - (
                  abs(cp.default_reference_price - v_price)
                  / greatest(v_price::numeric, 1::numeric)
                )::numeric * 0.25::numeric
              ) / 0.25::numeric
            )
          )
        else 0.35::numeric
      end
    into v_name1, v_brand1, v_cat1, v_price1
    from public.catalog_products cp
    left join public.categories cat on cat.id = cp.category_id
    where cp.id = c1.catalog_product_id;

    v_var1 := greatest(0::numeric, least(1::numeric, v_name1 * 0.95::numeric));
    v_fmt1 := greatest(0::numeric, least(1::numeric, v_name1 * 0.90::numeric));

    v_hard := (v_name1 > 0.82::numeric and v_brand1 < 0.12::numeric);

    v_fingerprint := public.catalog_text_search_norm(trim(lower(r.product_name)));
    select coalesce(sum(f.penalty_delta), 0::numeric) into v_feedback_adj
    from public.homologation_user_feedback f
    where f.fingerprint = v_fingerprint;

    v_fb := greatest(0::numeric, least(1::numeric, 0.5::numeric + least(0.5::numeric, greatest(-0.5::numeric, v_feedback_adj / 20.0::numeric))));

    v_link_boost := 0::numeric;
    if exists (
      select 1 from public.catalog_retail_links lk
      where lower(trim(lk.retailer)) = lower(trim(r.retailer))
        and lk.external_ref = r.external_ref
        and lk.catalog_product_id = c1.catalog_product_id
    ) then
      v_link_boost := public.homologation_weight('LINK_BOOST');
    end if;

    v_penalty := 0::numeric;

    if c2.catalog_product_id is not null then
      select
        greatest(0::numeric, least(1::numeric, similarity(
          public.catalog_text_search_norm(r.product_name),
          public.catalog_text_search_norm(cp.name)
        )::numeric)),
        greatest(0::numeric, least(1::numeric, similarity(
          public.catalog_text_search_norm(coalesce(r.brand, '')),
          public.catalog_text_search_norm(coalesce(cp.brand, ''))
        )::numeric)),
        case
          when cat.id is null then 0.35::numeric
          else greatest(0::numeric, least(1::numeric, similarity(
            public.catalog_text_search_norm(trim(coalesce(r.sections, '') || ' ' || coalesce(r.categories, ''))),
            public.catalog_text_search_norm(coalesce(cat.name, ''))
          )::numeric))
        end,
        case
          when cp.default_reference_price is not null and coalesce(v_price, 0) > 0 then
            greatest(
              0::numeric,
              least(
                1::numeric,
                (
                  0.25::numeric
                  - (
                    abs(cp.default_reference_price - v_price)
                    / greatest(v_price::numeric, 1::numeric)
                  )::numeric * 0.25::numeric
                ) / 0.25::numeric
              )
            )
          else 0.35::numeric
        end
      into v_name2, v_brand2, v_cat2, v_price2
      from public.catalog_products cp
      left join public.categories cat on cat.id = cp.category_id
      where cp.id = c2.catalog_product_id;

      v_var2 := greatest(0::numeric, least(1::numeric, v_name2 * 0.95::numeric));
      v_fmt2 := greatest(0::numeric, least(1::numeric, v_name2 * 0.90::numeric));
    else
      v_name2 := 0; v_brand2 := 0; v_cat2 := 0; v_price2 := 0; v_var2 := 0; v_fmt2 := 0;
    end if;

    v_score1 :=
      public.homologation_weight('name') * v_name1
      + public.homologation_weight('variant') * v_var1
      + public.homologation_weight('format') * v_fmt1
      + public.homologation_weight('brand') * v_brand1
      + public.homologation_weight('category') * v_cat1
      + public.homologation_weight('price') * v_price1
      + public.homologation_weight('feedback') * v_fb
      + v_link_boost
      - v_penalty;

    v_score2 :=
      public.homologation_weight('name') * v_name2
      + public.homologation_weight('variant') * v_var2
      + public.homologation_weight('format') * v_fmt2
      + public.homologation_weight('brand') * v_brand2
      + public.homologation_weight('category') * v_cat2
      + public.homologation_weight('price') * v_price2
      + public.homologation_weight('feedback') * v_fb
      + 0::numeric
      - v_penalty;

    v_score1 := greatest(0::numeric, least(1::numeric, v_score1));
    v_score2 := greatest(0::numeric, least(1::numeric, v_score2));
    v_gap := greatest(0::numeric, v_score1 - v_score2);
    v_base := v_score1;
    v_best := c1.catalog_product_id;
    v_second := c2.catalog_product_id;

    v_row := jsonb_build_object(
      'name_score', v_name1,
      'variant_score', v_var1,
      'format_score', v_fmt1,
      'brand_score', v_brand1,
      'category_score', v_cat1,
      'price_score', v_price1,
      'feedback_score', v_fb,
      'link_boost', v_link_boost,
      'penalties', v_penalty,
      'hard_conflict', v_hard,
      'rpc_top_match_score', c1.match_score,
      'second_rpc_match_score', c2.match_score
    );

    v_ai_req := false;
    v_final := null;
    v_decision := null;
    v_auto_ok := (not v_hard) and v_base >= 0.90::numeric and v_gap >= 0.08::numeric;

    if v_hard then
      v_decision := 'HARD_CONFLICT';
      v_final := 'USER_REVIEW';
      v_ai_req := false;
    elsif v_auto_ok then
      v_decision := 'AUTO_TENTATIVE';
      v_final := 'ACTIVE_TENTATIVE_BASE';
      v_ai_req := false;
    elsif v_base < 0.70::numeric then
      v_decision := 'PENDING_NEW_SCORE';
      v_final := 'PENDING_NEW';
      v_ai_req := false;
    elsif v_base >= 0.70::numeric and v_base < 0.90::numeric then
      v_decision := 'GRAY_IA';
      v_final := 'GRAY_IA_QUEUED';
      v_ai_req := true;
    else
      -- 0.90..1 pero gap pequeño o sin autovínculo tentativo
      v_decision := 'AMBIGUOUS_GAP';
      v_final := 'GRAY_IA_QUEUED';
      v_ai_req := true;
    end if;

    update public.scrapping s
    set
      base_score = v_base,
      base_decision = v_decision,
      base_best_product_id = v_best,
      base_second_product_id = v_second,
      base_gap = v_gap,
      base_result = v_row,
      ai_required = v_ai_req,
      ai_score = null,
      ai_decision = null,
      ai_result = null,
      homolog_user_decision = null,
      homolog_reviewed_at = null,
      homolog_final_status = case
        when v_final = 'PENDING_NEW' then 'PENDING_NEW'
        when v_final = 'ACTIVE_TENTATIVE_BASE' then 'ACTIVE_TENTATIVE_BASE'
        when v_final = 'GRAY_IA_QUEUED' then 'GRAY_IA_QUEUED'
        when v_final = 'USER_REVIEW' then 'USER_REVIEW'
        else v_final
      end,
      catalog_match_status = case
        when v_final = 'PENDING_NEW' then 'pending_new'
        when v_final = 'ACTIVE_TENTATIVE_BASE' then 'pending_homolog'
        when v_final = 'USER_REVIEW' then 'pending'
        when v_final = 'GRAY_IA_QUEUED' then 'pending'
        else s.catalog_match_status
      end,
      matched_catalog_product_id = case
        when v_final = 'ACTIVE_TENTATIVE_BASE' then v_best
        when v_final = 'PENDING_NEW' then null
        else s.matched_catalog_product_id
      end,
      homolog_step2_computed_at = now()
    where s.id = r.id;

    if v_final = 'ACTIVE_TENTATIVE_BASE' then v_auto := v_auto + 1;
    elsif v_final = 'GRAY_IA_QUEUED' then v_gray := v_gray + 1;
    elsif v_final = 'PENDING_NEW' then v_new := v_new + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'auto_tentative_base', v_auto,
    'gray_ia_queued', v_gray,
    'pending_new', v_new
  );
end;
$$;

comment on function public.scrapping_homologation_step2_compute_all_pending() is
  'Paso 2 motor DB: recalcula score base y estados para todas las filas scrapping pending. service_role desde servidor.';

revoke all on function public.scrapping_homologation_step2_compute_all_pending() from public;
grant execute on function public.scrapping_homologation_step2_compute_all_pending() to service_role;
