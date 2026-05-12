-- Permisos service_role sobre mapeos de taxonomía retail.

do $guard$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'retail_taxonomy_mappings'
  ) then
    raise exception
      'Falta la tabla public.retail_taxonomy_mappings. Aplica primero supabase/migrations/20260612131000_retail_taxonomy_mappings.sql.';
  end if;
end;
$guard$;

grant select, insert, update, delete, references, trigger on table public.retail_taxonomy_mappings to service_role;
