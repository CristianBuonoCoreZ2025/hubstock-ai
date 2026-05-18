-- Tabla de changelog técnico: trazabilidad de cambios de código
-- Permite auditar qué se modificó, cuándo y por qué
-- BEVECOHO: La base guarda TODO

create table if not exists app_changelog (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  module text not null,
  description text not null,
  files_changed text[] default '{}',
  author text default null,
  commit_hash text default null,
  tags text[] default '{}',
  created_at timestamptz not null default now()
);

-- Índices
comment on table app_changelog is 'Changelog técnico de cambios de código y arquitectura';

-- Vista: resumen de cambios por módulo
