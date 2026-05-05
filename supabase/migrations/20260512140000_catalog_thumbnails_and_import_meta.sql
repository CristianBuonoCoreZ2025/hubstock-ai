-- Miniaturas y trazabilidad de import (p. ej. Lider). thumbnail_url = URL pública completa del objeto en Storage.
alter table public.catalog_products
  add column if not exists thumbnail_url text,
  add column if not exists source_system text,
  add column if not exists source_product_url text;

comment on column public.catalog_products.thumbnail_url is 'URL pública del objeto en bucket catalog-thumbnails (generada al importar).';
comment on column public.catalog_products.source_system is 'Origen del registro: manual, lider_sqlite, etc.';
comment on column public.catalog_products.source_product_url is 'URL canónica del retailer para deduplicar importaciones.';

create unique index if not exists idx_catalog_products_source_product_url_unique
  on public.catalog_products (source_product_url)
  where source_product_url is not null;

-- Bucket público para miniaturas WebP/JPEG del catálogo maestro
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-thumbnails',
  'catalog-thumbnails',
  true,
  524288,
  array['image/webp', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "catalog_thumbnails_select_authenticated" on storage.objects;
create policy "catalog_thumbnails_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'catalog-thumbnails');

drop policy if exists "catalog_thumbnails_select_anon" on storage.objects;
create policy "catalog_thumbnails_select_anon"
  on storage.objects for select
  to anon
  using (bucket_id = 'catalog-thumbnails');

drop policy if exists "catalog_thumbnails_insert_service_role" on storage.objects;
create policy "catalog_thumbnails_insert_service_role"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'catalog-thumbnails');

drop policy if exists "catalog_thumbnails_update_service_role" on storage.objects;
create policy "catalog_thumbnails_update_service_role"
  on storage.objects for update
  to service_role
  using (bucket_id = 'catalog-thumbnails')
  with check (bucket_id = 'catalog-thumbnails');

drop policy if exists "catalog_thumbnails_delete_service_role" on storage.objects;
create policy "catalog_thumbnails_delete_service_role"
  on storage.objects for delete
  to service_role
  using (bucket_id = 'catalog-thumbnails');

-- Copiar miniatura al inventario cuando exista
create or replace function public.copy_catalog_products_to_profile(
  p_profile_id uuid,
  p_created_by uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if not exists (
    select 1 from public.profile_members pm
    where pm.profile_id = p_profile_id
      and pm.user_id = p_created_by
      and pm.status = 'active'
      and pm.role in ('admin', 'editor')
  ) then
    raise exception 'not_allowed';
  end if;

  insert into public.products (
    profile_id,
    section_id,
    category_id,
    name,
    brand,
    format,
    unit,
    stock_current,
    stock_min,
    stock_ideal,
    reference_price,
    last_price,
    location,
    image_url,
    active,
    catalog_product_id,
    created_by
  )
  select
    p_profile_id,
    cp.section_id,
    cp.category_id,
    cp.name,
    cp.brand,
    cp.format,
    cp.unit,
    0,
    null,
    null,
    cp.default_reference_price,
    null,
    null,
    cp.thumbnail_url,
    true,
    cp.id,
    p_created_by
  from public.catalog_products cp
  where cp.active = true
    and not exists (
      select 1
      from public.products pr
      where pr.profile_id = p_profile_id
        and pr.catalog_product_id = cp.id
    );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.copy_catalog_products_to_profile(uuid, uuid) from public;
grant execute on function public.copy_catalog_products_to_profile(uuid, uuid) to authenticated;
