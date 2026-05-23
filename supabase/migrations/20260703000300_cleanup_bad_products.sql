-- ============================================================================
-- Script de LIMPIEZA SEGURO: revertir productos malos creados por v1.
-- EJECUTAR EN UNA TRANSACCION para poder hacer ROLLBACK si algo falla.
--
-- begin;
--   -- pegar aqui todo el contenido
-- commit;
-- ============================================================================

-- 0. Guardar IDs de productos malos en una tabla temp para referencia
select cp.id as bad_product_id
into temp _tmp_bad_products
from public.catalog_products cp
left join public.sections s on s.id = cp.section_id
left join public.categories c on c.id = cp.category_id
where cp.source_system in ('scrapping_homologation', 'scrapping_homologation_v2')
  and (
    s.name = 'General' or c.name = 'Sin categoria'
    or cp.section_id is null or cp.category_id is null
  );

-- 1. Devolver scrapping a pending_new (quitar vinculo a productos malos)
update public.scrapping s
set
  catalog_match_status = 'pending_new',
  matched_catalog_product_id = null,
  catalog_matched_at = null,
  homolog_final_status = null,
  homolog_reviewed_at = null
where s.matched_catalog_product_id in (select bad_product_id from _tmp_bad_products);

-- 2. Borrar aliases de productos malos
-- delete from public.catalog_product_aliases
-- where catalog_product_id in (select bad_product_id from _tmp_bad_products);

-- 3. Borrar retail snapshots de productos malos
-- delete from public.catalog_retail_snapshots s
-- where exists (
--   select 1 from public.catalog_retail_links lk
--   where lk.catalog_product_id in (select bad_product_id from _tmp_bad_products)
--     and lk.retailer = s.retailer and lk.external_ref = s.external_ref
-- );

-- 4. Borrar retail links de productos malos
-- delete from public.catalog_retail_links
-- where catalog_product_id in (select bad_product_id from _tmp_bad_products);

-- 5. Borrar productos malos del catalogo
-- delete from public.catalog_products
-- where id in (select bad_product_id from _tmp_bad_products);

-- ============================================================================
-- NOTA: Los pasos 2-5 estan comentados para que primero hagas el paso 1
-- (devolver scrapping a pending_new) y luego ejecutes el resto confirmado.
--
-- Para ejecutar TODO de una vez, descomenta los pasos 2-5.
-- ============================================================================

-- Validacion: confirmar que scrapping volvio a pending_new
select
  count(*) as pending_new_restored
from public.scrapping
where catalog_match_status = 'pending_new';
