-- Marcas maestras del catálogo + vínculo desde catalog_products (deduplicación por nombre normalizado).

create table if not exists public.catalog_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_catalog_brands_name_lower_unique
  on public.catalog_brands ((lower(trim(name))));

comment on table public.catalog_brands is
  'Marca canónica una sola vez; catalog_products.brand_id referencia aquí; catalog_products.brand sigue como texto de respaldo.';

alter table public.catalog_products
  add column if not exists brand_id uuid references public.catalog_brands (id) on delete set null;

create index if not exists idx_catalog_products_brand_id on public.catalog_products (brand_id);

alter table public.catalog_brands enable row level security;

drop policy if exists "catalog_brands_select_authenticated" on public.catalog_brands;
create policy "catalog_brands_select_authenticated"
  on public.catalog_brands for select
  to authenticated
  using (true);

-- Copiar al perfil: texto de marca desde catalog_brands si hay brand_id
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
    coalesce(
      (select b.name from public.catalog_brands b where b.id = cp.brand_id limit 1),
      cp.brand
    ),
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
