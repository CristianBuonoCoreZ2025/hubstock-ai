-- Etapa B: purga set-based de scrapping ya vinculado en catalog_retail_links (paso 1).

create or replace function public.scrapping_purge_rows_with_retail_link()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted int := 0;
begin
  with deleted as (
    delete from public.scrapping s
    using public.catalog_retail_links l
    where s.retailer = l.retailer
      and trim(coalesce(s.external_ref, '')) = trim(coalesce(l.external_ref, ''))
    returning s.id
  )
  select count(*)::int into v_deleted from deleted;

  return jsonb_build_object('deleted', coalesce(v_deleted, 0));
end;
$$;

comment on function public.scrapping_purge_rows_with_retail_link() is
  'Elimina filas scrapping cuyo retailer+external_ref ya existe en catalog_retail_links. Invocar con service_role desde servidor.';

revoke all on function public.scrapping_purge_rows_with_retail_link() from public;
grant execute on function public.scrapping_purge_rows_with_retail_link() to service_role;
