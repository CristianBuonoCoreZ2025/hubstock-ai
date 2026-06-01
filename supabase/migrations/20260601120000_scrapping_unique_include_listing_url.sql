-- Eliminar constraint antigua si existe
alter table public.scrapping
  drop constraint if exists scrapping_run_id_retailer_external_ref_key;

-- Validar duplicados antes de crear la nueva unique constraint
do $$
begin
  if exists (
    select 1
    from public.scrapping
    group by run_id, retailer, external_ref, listing_url
    having count(*) > 1
  ) then
    raise exception 'Hay duplicados en scrapping para run_id, retailer, external_ref, listing_url. Limpia los datos antes de crear la constraint.';
  end if;
end $$;

-- Crear nueva constraint solo si no existe
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.scrapping'::regclass
      and conname = 'scrapping_run_id_retailer_external_ref_listing_url_key'
  )
  and to_regclass('public.scrapping_run_id_retailer_external_ref_listing_url_key') is null then

    alter table public.scrapping
      add constraint scrapping_run_id_retailer_external_ref_listing_url_key
      unique (run_id, retailer, external_ref, listing_url);

  end if;
end $$;