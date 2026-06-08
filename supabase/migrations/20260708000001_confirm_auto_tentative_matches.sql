-- ============================================================================
-- Confirmar matches auto-tentativos del paso 2 (motor + IA)
-- ============================================================================
-- Problema:
--   El paso 2 motor marca filas como ACTIVE_TENTATIVE_BASE y el paso 2 IA
--   como ACTIVE_TENTATIVE_AI_SUPPORTED, pero solo actualizan la tabla
--   scrapping. No crean los vinculos reales en catalog_retail_links,
--   catalog_product_aliases, catalog_retail_snapshots ni actualizan
--   la imagen del maestro.
--
-- Solucion:
--   Esta funcion procesa en chunks todos los scrapping con
--   homolog_final_status en (ACTIVE_TENTATIVE_BASE, ACTIVE_TENTATIVE_AI_SUPPORTED)
--   y matched_catalog_product_id not null. Por cada uno:
--     1. Inserta/actualiza catalog_retail_links
--     2. Inserta catalog_product_aliases (ignora duplicados)
--     3. Inserta catalog_retail_snapshots (precio, titulo, imagen)
--     4. Actualiza thumb_url del maestro si esta vacio
--     5. Borra la fila de scrapping
--
-- Se ejecuta despues del paso 2 motor y despues del paso 2 IA gris.
-- ============================================================================

create or replace function public.scrapping_confirm_auto_tentative_matches(
  p_chunk_size integer default 3000
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_confirmed int := 0;
  v_deleted int := 0;
  v_batch_count int;
begin
  <<confirm_loop>>
  loop
    -- Seleccionar un lote de filas auto-tentativas
    create temporary table _auto_chunk on commit drop as
    select
      s.id as scrapping_id,
      s.retailer,
      s.external_ref,
      s.product_url,
      s.product_name,
      s.brand,
      s.price,
      s.image_url,
      s.matched_catalog_product_id as catalog_id
    from public.scrapping s
    where s.homolog_final_status in ('ACTIVE_TENTATIVE_BASE', 'ACTIVE_TENTATIVE_AI_SUPPORTED')
      and s.matched_catalog_product_id is not null
    order by s.created_at asc, s.id asc
    limit p_chunk_size;

    select count(*)::int into v_batch_count from _auto_chunk;

    exit confirm_loop when v_batch_count = 0;

    -- 1. Vincular retail
    insert into public.catalog_retail_links (retailer, external_ref, catalog_product_id, updated_at)
    select ac.retailer, ac.external_ref, ac.catalog_id, now()
    from _auto_chunk ac
    on conflict (retailer, external_ref) do update
      set catalog_product_id = excluded.catalog_product_id,
          updated_at = now();

    -- 2. Insertar alias
    insert into public.catalog_product_aliases (catalog_product_id, alias_normalized)
    select ac.catalog_id, public.catalog_text_search_norm(ac.product_name)
    from _auto_chunk ac
    on conflict (catalog_product_id, alias_normalized) do nothing;

    -- 3. Insertar snapshot
    insert into public.catalog_retail_snapshots (retailer, external_ref, source_url, title, price, captured_at, image_url)
    select ac.retailer, ac.external_ref, ac.product_url, ac.product_name, ac.price, now(), ac.image_url
    from _auto_chunk ac;

    -- 4. Actualizar thumb_url del maestro si esta vacio
    update public.catalog_products cp
    set thumb_url = ac.image_url
    from _auto_chunk ac
    where cp.id = ac.catalog_id
      and coalesce(cp.thumb_url, '') = ''
      and coalesce(ac.image_url, '') <> '';

    -- 5. Borrar filas scrapping
    delete from public.scrapping s
    using _auto_chunk ac
    where s.id = ac.scrapping_id;

    get diagnostics v_deleted = row_count;
    v_confirmed := v_confirmed + v_deleted;
  end loop confirm_loop;

  return jsonb_build_object(
    'confirmed', coalesce(v_confirmed, 0)
  );
end;
$$;

comment on function public.scrapping_confirm_auto_tentative_matches(integer) is
  'Confirma matches auto-tentativos del paso 2 (motor + IA): crea vinculos retail, alias, snapshots e imagen, y borra de scrapping.';

revoke all on function public.scrapping_confirm_auto_tentative_matches(integer) from public;
grant execute on function public.scrapping_confirm_auto_tentative_matches(integer) to service_role;
