-- Origen retail configurable para scraping masivo + métricas de referencia por corrida.

create table if not exists public.retail (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  max_pages int not null default 0,
  max_products int not null default 0,
  created_at timestamptz not null default now(),
  constraint retail_name_unique unique (name)
);

comment on table public.retail is
  'Retail de lectura para scraping; base_url es el origen del storefront. max_* = máximo histórico detectado en corridas.';

insert into public.retail (name, base_url)
select 'Lider', 'https://super.lider.cl'
where not exists (select 1 from public.retail where lower(name) = 'lider');

alter table public.scrapping_runs
  add column if not exists retail_id uuid references public.retail (id) on delete set null;

alter table public.scrapping_runs
  add column if not exists pages_ok int not null default 0;

alter table public.scrapping_runs
  add column if not exists pages_failed int not null default 0;

create index if not exists idx_scrapping_runs_retail_id on public.scrapping_runs (retail_id);

update public.scrapping_runs r
set retail_id = (select id from public.retail where lower(name) = 'lider' limit 1)
where r.retail_id is null;

alter table public.retail enable row level security;

drop policy if exists "retail_select_authenticated" on public.retail;
create policy "retail_select_authenticated" on public.retail for select to authenticated using (true);

grant select on table public.retail to authenticated;
