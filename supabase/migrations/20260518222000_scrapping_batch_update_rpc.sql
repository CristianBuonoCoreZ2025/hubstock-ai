-- RPC para actualizar batch de filas scrapping a 'matched'
-- BEVECOHO: La base resuelve todo atómicamente. No upserts fallidos.

create or replace function update_scrapping_matched_batch(
  p_ids uuid[],
  p_catalog_product_ids uuid[],
  p_homolog_statuses text[]
)
returns int
language plpgsql
as $$
declare
  updated_count int := 0;
begin
  update public.scrapping
  set
    catalog_match_status = 'matched',
    matched_catalog_product_id = batch.catalog_product_id,
    homolog_final_status = batch.homolog_status,
    catalog_matched_at = now(),
    homolog_reviewed_at = now()
  from (
    select
      unnest(p_ids) as id,
      unnest(p_catalog_product_ids) as catalog_product_id,
      unnest(p_homolog_statuses) as homolog_status
  ) as batch
  where public.scrapping.id = batch.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

comment on function update_scrapping_matched_batch is 'Actualiza batch de filas scrapping a matched. Retorna cantidad de filas actualizadas.';
