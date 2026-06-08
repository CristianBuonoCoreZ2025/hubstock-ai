-- ============================================================================
-- PASO 1 v2: Match exacto + fuzzy por marca + similitud pg_trgm
-- ============================================================================
-- Problema:
--   scrapping_apply_exact_catalog_matches original solo compara
--   trim(product_name) = trim(name) (igualdad exacta).
--   Los nombres de retail (Lider/Jumbo) rara vez coinciden exactamente
--   con los del catalogo maestro → paso 1 devuelve 0 siempre.
--
-- Solucion:
--   Mantener pasada exacta (rapida, sin cambios).
--   Agregar pasada 2 fuzzy: cuando la marca coincide, usa
--   similarity(pg_trgm) sobre catalog_text_search_norm() para
--   detectar el mismo producto con nombre distinto.
--   Actualiza default_reference_price (max precio visto) y
--   borra filas scrapping coincidentes, igual que antes.
--
-- Requisitos:
--   - Extension pg_trgm ya instalada
--   - Indice: idx_catalog_products_name_search_norm_trgm
--   - Funcion: catalog_text_search_norm ya existente
-- ============================================================================

create or replace function public.scrapping_apply_exact_catalog_matches()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- Pasada 1 (exacta)
  v_exact_removed int := 0;
  v_exact_updated int := 0;
  v_exact_masters int := 0;
  -- Pasada 2 (fuzzy)
  v_fuzzy_removed int := 0;
  v_fuzzy_updated int := 0;
  v_fuzzy_masters int := 0;
begin
  -- ========================================================================
  -- PASADA 1: Match exacto (sin cambios respecto a v1)
  -- ========================================================================
  create temporary table _catalog_key on commit drop as
  select distinct on (trim(cp.name), lower(trim(coalesce(cp.brand, ''))))
    trim(cp.name) as pn,
    lower(trim(coalesce(cp.brand, ''))) as bn,
    cp.id as catalog_id
  from public.catalog_products cp
  where coalesce(cp.active, true) is true
  order by trim(cp.name), lower(trim(coalesce(cp.brand, ''))), cp.id;

  create temporary table _scr_join on commit drop as
  select
    s.id as scrapping_id,
    k.catalog_id,
    s.price as row_price
  from public.scrapping s
  inner join _catalog_key k
    on trim(s.product_name) = k.pn
    and lower(trim(coalesce(s.brand, ''))) = k.bn
  where s.catalog_match_status = 'pending';

  create temporary table _cat_price on commit drop as
  select catalog_id, max(row_price) as new_price
  from _scr_join
  group by catalog_id;

  update public.catalog_products cp
  set
    default_reference_price = p.new_price,
    updated_at = now()
  from _cat_price p
  where cp.id = p.catalog_id;

  get diagnostics v_exact_updated = row_count;

  -- Vincular retail + insertar alias + snapshot + imagen (pasada exacta)
  insert into public.catalog_retail_links (retailer, external_ref, catalog_product_id, updated_at)
  select s.retailer, s.external_ref, j.catalog_id, now()
  from _scr_join j
  join public.scrapping s on s.id = j.scrapping_id
  on conflict (retailer, external_ref) do update
    set catalog_product_id = excluded.catalog_product_id,
        updated_at = now();

  insert into public.catalog_product_aliases (catalog_product_id, alias_normalized)
  select j.catalog_id, public.catalog_text_search_norm(s.product_name)
  from _scr_join j
  join public.scrapping s on s.id = j.scrapping_id
  on conflict (catalog_product_id, alias_normalized) do nothing;

  insert into public.catalog_retail_snapshots (retailer, external_ref, source_url, title, price, captured_at, image_url)
  select s.retailer, s.external_ref, s.product_url, s.product_name, s.price, now(), s.image_url
  from _scr_join j
  join public.scrapping s on s.id = j.scrapping_id;

  -- Actualizar thumb_url del maestro si está vacío y tenemos imagen
  update public.catalog_products cp
  set thumb_url = s.image_url
  from _scr_join j
  join public.scrapping s on s.id = j.scrapping_id
  where cp.id = j.catalog_id
    and coalesce(cp.thumb_url, '') = ''
    and coalesce(s.image_url, '') <> '';

  delete from public.scrapping s
  using _scr_join j
  where s.id = j.scrapping_id;

  get diagnostics v_exact_removed = row_count;

  select count(distinct catalog_id)::int into v_exact_masters from _scr_join;

  -- ========================================================================
  -- PASADA 2: Match fuzzy por marca + similitud de nombre (pg_trgm)
  -- ========================================================================
  -- Procesa en lotes de 3000 para evitar statement timeout.
  -- Ajusta pg_trgm.similarity_threshold a 0.55 para que el operador %
  -- devuelva menos candidatos y el indice GIN sea mas selectivo.

  set local pg_trgm.similarity_threshold = 0.55;

  -- Tabla temporal reutilizable para cada chunk
  create temporary table _fuzzy_chunk (
    scrapping_id uuid primary key,
    row_price numeric,
    catalog_id uuid
  ) on commit drop;

  <<fuzzy_loop>>
  loop
    -- Lote de 3000 filas pending mas antiguas que tienen marca
    declare
      v_batch_min timestamptz;
      v_batch_max timestamptz;
      v_chunk_count int := 0;
      v_chunk_updated int := 0;
    begin
      select min(s.created_at), max(s.created_at)
      into v_batch_min, v_batch_max
      from (
        select created_at
        from public.scrapping
        where catalog_match_status = 'pending'
          and brand is not null
          and trim(brand) <> ''
        order by created_at asc, id asc
        limit 3000
      ) s;

      exit fuzzy_loop when v_batch_min is null;

      -- Vaciar chunk anterior
      truncate table _fuzzy_chunk;

      -- Encontrar el mejor match fuzzy para cada fila del lote
      insert into _fuzzy_chunk (scrapping_id, row_price, catalog_id)
      with
      pending_subset as (
        select
          s.id,
          s.product_name,
          s.price,
          s.brand
        from public.scrapping s
        where s.catalog_match_status = 'pending'
          and s.brand is not null
          and trim(s.brand) <> ''
          and s.created_at between v_batch_min and v_batch_max
      )
      select distinct on (ps.id)
        ps.id as scrapping_id,
        ps.price as row_price,
        cp.id as catalog_id
      from pending_subset ps
      join public.catalog_products cp
        on coalesce(cp.active, true) = true
        and lower(trim(coalesce(cp.brand, ''))) = lower(trim(coalesce(ps.brand, '')))
        and public.catalog_text_search_norm(cp.name) % public.catalog_text_search_norm(ps.product_name)
      order by ps.id,
        similarity(
          public.catalog_text_search_norm(cp.name),
          public.catalog_text_search_norm(ps.product_name)
        ) desc;

      select count(*)::int into v_chunk_count from _fuzzy_chunk;

      exit fuzzy_loop when v_chunk_count = 0;

      -- Actualizar precios maestro (maximo precio visto por catalog_id)
      update public.catalog_products cp
      set
        default_reference_price = pa.new_price,
        updated_at = now()
      from (
        select catalog_id, max(row_price) as new_price
        from _fuzzy_chunk
        group by catalog_id
      ) pa
      where cp.id = pa.catalog_id;

      get diagnostics v_chunk_updated = row_count;

      v_fuzzy_updated := v_fuzzy_updated + v_chunk_updated;

      -- Vincular retail + insertar alias + snapshot + imagen (pasada fuzzy)
      insert into public.catalog_retail_links (retailer, external_ref, catalog_product_id, updated_at)
      select s.retailer, s.external_ref, fc.catalog_id, now()
      from _fuzzy_chunk fc
      join public.scrapping s on s.id = fc.scrapping_id
      on conflict (retailer, external_ref) do update
        set catalog_product_id = excluded.catalog_product_id,
            updated_at = now();

      insert into public.catalog_product_aliases (catalog_product_id, alias_normalized)
      select fc.catalog_id, public.catalog_text_search_norm(s.product_name)
      from _fuzzy_chunk fc
      join public.scrapping s on s.id = fc.scrapping_id
      on conflict (catalog_product_id, alias_normalized) do nothing;

      insert into public.catalog_retail_snapshots (retailer, external_ref, source_url, title, price, captured_at, image_url)
      select s.retailer, s.external_ref, s.product_url, s.product_name, s.price, now(), s.image_url
      from _fuzzy_chunk fc
      join public.scrapping s on s.id = fc.scrapping_id;

      -- Actualizar thumb_url del maestro si está vacío y tenemos imagen
      update public.catalog_products cp
      set thumb_url = s.image_url
      from _fuzzy_chunk fc
      join public.scrapping s on s.id = fc.scrapping_id
      where cp.id = fc.catalog_id
        and coalesce(cp.thumb_url, '') = ''
        and coalesce(s.image_url, '') <> '';

      -- Borrar filas scrapping que hicieron match fuzzy
      delete from public.scrapping s
      using _fuzzy_chunk fc
      where s.id = fc.scrapping_id;

      v_fuzzy_removed := v_fuzzy_removed + v_chunk_count;
    end;
  end loop fuzzy_loop;

  v_fuzzy_masters := v_fuzzy_updated;

  -- ========================================================================
  -- Limpieza de legado exact_match
  -- ========================================================================
  delete from public.scrapping
  where catalog_match_status = 'exact_match';

  -- ========================================================================
  -- Retorno compatible hacia atras + detalle de fuzzy
  -- ========================================================================
  return jsonb_build_object(
    'scrappingRowsRemoved', coalesce(v_exact_removed, 0) + coalesce(v_fuzzy_removed, 0),
    'catalogProductsUpdated', coalesce(v_exact_updated, 0) + coalesce(v_fuzzy_updated, 0),
    'distinctCatalogProducts', coalesce(v_exact_masters, 0) + coalesce(v_fuzzy_masters, 0),
    -- Detalle para diagnostico
    'exactRemoved', coalesce(v_exact_removed, 0),
    'fuzzyRemoved', coalesce(v_fuzzy_removed, 0),
    'fuzzyUpdated', coalesce(v_fuzzy_updated, 0),
    'fuzzyMasters', coalesce(v_fuzzy_masters, 0)
  );
end;
$$;

comment on function public.scrapping_apply_exact_catalog_matches() is
  'Paso 1 v2: match exacto + fuzzy por marca+similitud (pg_trgm). Actualiza precio maestro y borra filas scrapping coincidentes.';

revoke all on function public.scrapping_apply_exact_catalog_matches() from public;
grant execute on function public.scrapping_apply_exact_catalog_matches() to service_role;
