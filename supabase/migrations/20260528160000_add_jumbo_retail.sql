-- Agregar Jumbo a la tabla retail para scraping
insert into public.retail (name, base_url, max_pages, max_products)
select 'Jumbo', 'https://www.jumbo.cl', 0, 0
where not exists (select 1 from public.retail where lower(name) = 'jumbo');
