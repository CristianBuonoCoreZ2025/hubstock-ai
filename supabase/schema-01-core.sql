-- StockCasa: núcleo (perfiles, membresía, invitaciones, catálogo global).
-- Referencia del modelo final (mismo resultado que la cadena en supabase/migrations).
--
-- Base NUEVA vacía: ejecutar 01 → 02 → 03 → 04 → 05 o supabase/schema-all.sql
-- Base con DATOS (producción / dev con historial): NO ejecutar este script; aplicar
--   migraciones con `supabase db push` o copiar el SQL de supabase/migrations/ al editor.
--   La migración 20260508120000_ensure_canonical_forward.sql alinea lo que falte.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Tablas core
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.profile_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, user_id)
);

CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES public.sections (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (section_id, name)
);

CREATE INDEX idx_profile_members_user ON public.profile_members (user_id);
CREATE INDEX idx_profile_members_profile ON public.profile_members (profile_id);

-- ---------------------------------------------------------------------------
-- Triggers: admin al crear perfil + updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_members (profile_id, user_id, role, status)
  VALUES (NEW.id, auth.uid(), 'admin', 'active');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_profile_members_updated_at
  BEFORE UPDATE ON public.profile_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: secciones y categoría "General" por sección (idempotente por nombre)
-- ---------------------------------------------------------------------------
INSERT INTO public.sections (name, sort_order)
SELECT v.name, v.sort_order
FROM (
  VALUES
    ('Frutas y verduras', 10),
    ('Carnes y pescados', 20),
    ('Lácteos y refrigerados', 30),
    ('Congelados', 40),
    ('Despensa', 50),
    ('Panadería', 60),
    ('Bebidas', 70),
    ('Aseo hogar', 80),
    ('Higiene personal', 90),
    ('Mascotas', 100),
    ('Bebé', 110),
    ('Farmacia hogar', 120),
    ('Otros', 130)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sections s WHERE s.name = v.name
);

INSERT INTO public.categories (section_id, name, sort_order)
SELECT s.id, 'General', 0
FROM public.sections s
WHERE s.name IN (
  'Frutas y verduras','Carnes y pescados','Lácteos y refrigerados','Congelados',
  'Despensa','Panadería','Bebidas','Aseo hogar','Higiene personal','Mascotas',
  'Bebé','Farmacia hogar','Otros'
)
AND NOT EXISTS (
  SELECT 1 FROM public.categories c WHERE c.section_id = s.id AND c.name = 'General'
);
