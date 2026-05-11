-- Permisos explícitos para captura por lotes (service_role).
-- Requiere que ya existan las tablas (migración 20260531120000_retail_capture_batches.sql).

do $guard$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'retail_capture_batches'
  ) then
    raise exception
      'Falta la tabla public.retail_capture_batches. En el SQL Editor de Supabase ejecuta primero, completo, el archivo supabase/migrations/20260531120000_retail_capture_batches.sql; después vuelve a aplicar esta migración (o ejecuta solo los GRANT de abajo cuando las tablas existan).';
  end if;
end;
$guard$;

grant usage on schema public to service_role;

grant select, insert, update, delete, references, trigger on table public.retail_capture_batches to service_role;
grant select, insert, update, delete, references, trigger on table public.retail_captured_products to service_role;
grant select, insert, update, delete, references, trigger on table public.retail_ai_match_reviews to service_role;
