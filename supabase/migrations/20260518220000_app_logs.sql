-- Tabla de logs técnicos del sistema (no para usuario final)
-- Registra errores, warnings e info de operaciones batch
-- BEVECOHO: Base Primero — la base guarda TODO

create table if not exists app_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('error', 'warn', 'info', 'debug')),
  module text not null,
  message text not null,
  context jsonb default null,
  screen text default null,
  session_id text default null,
  created_at timestamptz not null default now()
);

-- Índices para consultas comunes
comment on table app_logs is 'Logs técnicos del sistema para debugging y auditoría';

-- Permisos: solo el servidor puede insertar (service role)
-- No RLS: el servidor usa service role key
