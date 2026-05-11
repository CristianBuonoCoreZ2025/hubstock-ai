do $guard$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'retail_taxonomy_lider_sections'
  ) then
    raise exception
      'Falta public.retail_taxonomy_lider_sections. Aplica 20260613120000_retail_taxonomy_lider_sections.sql primero.';
  end if;
end;
$guard$;

grant select, insert, update, delete, references, trigger on table public.retail_taxonomy_lider_sections to service_role;
