-- Instalación completa en base de datos vacía (PostgreSQL, cliente `psql`).
-- Ejecutar desde la carpeta `supabase` del repo (ahí están los `\ir`).
--
-- Linux / macOS / Git Bash (variable típica de Supabase o Postgres):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema-all.sql
--
-- PowerShell (Windows): misma idea, sin `$` delante del nombre en env:
--   psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f schema-all.sql
--   (antes: $env:DATABASE_URL = "postgresql://usuario:clave@host:5432/postgres")
--
-- Sin `psql` instalado: usa el SQL Editor de Supabase y ejecuta en orden
-- schema-01-core.sql … schema-05-rls.sql (este archivo usa `\ir`, no se pega tal cual en el editor web).

\set ON_ERROR_STOP on

\ir schema-01-core.sql
\ir schema-02-products.sql
\ir schema-03-shopping.sql
\ir schema-04-stock-checks.sql
\ir schema-05-rls.sql
