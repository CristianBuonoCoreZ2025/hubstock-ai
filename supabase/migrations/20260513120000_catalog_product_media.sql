-- Miniaturas del catálogo maestro en tabla dedicada (Storage sigue en Supabase; solo referencias en BD).
-- Un único origen de verdad por producto: catalog_product_media.kind = 'thumbnail'.

create table if not exists public.catalog_product_media (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references public.catalog_products (id) on delete cascade,
  kind text not null default 'thumbnail'
    check (kind = 'thumbnail'),
  bucket_id text not null default 'catalog-thumbnails',
  object_path text not null,
  public_url text not null,
  created_at timestamptz not null default now(),
  unique (catalog_product_id, kind)
);

create index if not exists idx_catalog_product_media_catalog
  on public.catalog_product_media (catalog_product_id);

comment on table public.catalog_product_media is
  'Referencias a objetos en Storage (bucket catalog-thumbnails). Sin rutas locales; despliegue Vercel-safe.';

-- Migrar URLs que estaban en catalog_products.thumbnail_url (si existe la columna)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'catalog_products'
      and column_name = 'thumbnail_url'
  ) then
    insert into public.catalog_product_media (
      catalog_product_id,
      kind,
      bucket_id,
      object_path,
      public_url
    )
    select
      cp.id,
      'thumbnail',
      'catalog-thumbnails',
      coalesce(
        nullif(regexp_replace(cp.thumbnail_url, '^.*catalog-thumbnails/', ''), ''),
        regexp_replace(cp.thumbnail_url, '^.*/', '')
      ),
      cp.thumbnail_url
    from public.catalog_products cp
    where cp.thumbnail_url is not null
      and trim(cp.thumbnail_url) <> ''
    on conflict (catalog_product_id, kind) do nothing;

    alter table public.catalog_products drop column thumbnail_url;
  end if;
end $$;

alter table public.catalog_product_media enable row level security;

drop policy if exists "catalog_product_media_select_authenticated" on public.catalog_product_media;
create policy "catalog_product_media_select_authenticated"
  on public.catalog_product_media for select
  to authenticated
  using (true);

-- Copiar al perfil: imagen desde catalog_product_media (miniatura)
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
    (
      select m.public_url
      from public.catalog_product_media m
      where m.catalog_product_id = cp.id
        and m.kind = 'thumbnail'
      limit 1
    ),
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
