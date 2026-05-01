-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Function to automatically update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create tables
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE profile_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE (profile_id, user_id)
);

CREATE TABLE sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name)
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL,
  name TEXT NOT NULL,
  sort_order INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
  UNIQUE (section_id, name)
);

-- Create indexes
CREATE INDEX idx_profiles_created_by ON profiles(created_by);
CREATE INDEX idx_profile_members_profile_id ON profile_members(profile_id);
CREATE INDEX idx_profile_members_user_id ON profile_members(user_id);
CREATE INDEX idx_categories_section_id ON categories(section_id);

-- Insert initial data for sections
INSERT INTO sections (id, name, sort_order, created_at)
VALUES
  (gen_random_uuid(), 'Frutas y verduras', 1, NOW()),
  (gen_random_uuid(), 'Carnes y pescados', 2, NOW()),
  (gen_random_uuid(), 'Lácteos y refrigerados', 3, NOW()),
  (gen_random_uuid(), 'Congelados', 4, NOW()),
  (gen_random_uuid(), 'Despensa', 5, NOW()),
  (gen_random_uuid(), 'Panadería', 6, NOW()),
  (gen_random_uuid(), 'Bebidas', 7, NOW()),
  (gen_random_uuid(), 'Aseo hogar', 8, NOW()),
  (gen_random_uuid(), 'Higiene personal', 9, NOW()),
  (gen_random_uuid(), 'Mascotas', 10, NOW()),
  (gen_random_uuid(), 'Bebé', 11, NOW()),
  (gen_random_uuid(), 'Farmacia hogar', 12, NOW()),
  (gen_random_uuid(), 'Otros', 13, NOW())
ON CONFLICT (name) DO NOTHING;

-- Insert initial data for categories
INSERT INTO categories (id, section_id, name, sort_order, created_at)
SELECT gen_random_uuid(), id, category_name, sort_order, NOW()
FROM (
  SELECT
    s.id AS section_id,
    CASE
      WHEN s.name = 'Frutas y verduras' THEN 'Frutas'
      WHEN s.name = 'Frutas y verduras' THEN 'Verduras'
      WHEN s.name = 'Frutas y verduras' THEN 'Hortalizas'
      WHEN s.name = 'Carnes y pescados' THEN 'Carnes'
      WHEN s.name = 'Carnes y pescados' THEN 'Pescados'
      WHEN s.name = 'Carnes y pescados' THEN 'Mariscos'
      WHEN s.name = 'Lácteos y refrigerados' THEN 'Lácteos'
      WHEN s.name = 'Lácteos y refrigerados' THEN 'Refrigerados'
      WHEN s.name = 'Lácteos y refrigerados' THEN 'Huevos'
      WHEN s.name = 'Congelados' THEN 'Congelados'
      WHEN s.name = 'Congelados' THEN 'Pizzas'
      WHEN s.name = 'Congelados' THEN 'Postres'
      WHEN s.name = 'Despensa' THEN 'Enlatados'
      WHEN s.name = 'Despensa' THEN 'Aceites'
      WHEN s.name = 'Despensa' THEN 'Condimentos'
      WHEN s.name = 'Panadería' THEN 'Pan'
      WHEN s.name = 'Panadería' THEN 'Pastelería'
      WHEN s.name = 'Panadería' THEN 'Repostería'
      WHEN s.name = 'Bebidas' THEN 'Bebidas'
      WHEN s.name = 'Bebidas' THEN 'Jugos'
      WHEN s.name = 'Bebidas' THEN 'Bebidas alcohólicas'
      WHEN s.name = 'Aseo hogar' THEN 'Limpieza'
      WHEN s.name = 'Aseo hogar' THEN 'Desechables'
      WHEN s.name = 'Aseo hogar' THEN 'Muebles'
      WHEN s.name = 'Higiene personal' THEN 'Cuidado personal'
      WHEN s.name = 'Higiene personal' THEN 'Cuidado bucal'
      WHEN s.name = 'Higiene personal' THEN 'Cuidado corporal'
      WHEN s.name = 'Mascotas' THEN 'Alimentos'
      WHEN s.name = 'Mascotas' THEN 'Accesorios'
      WHEN s.name = 'Mascotas' THEN 'Cuidado'
      WHEN s.name = 'Bebé' THEN 'Alimentos'
      WHEN s.name = 'Bebé' THEN 'Cuidado'
      WHEN s.name = 'Bebé' THEN 'Accesorios'
      WHEN s.name = 'Farmacia hogar' THEN 'Medicamentos'
      WHEN s.name = 'Farmacia hogar' THEN 'Cuidado'
      WHEN s.name = 'Farmacia hogar' THEN 'Equipos'
      WHEN s.name = 'Otros' THEN 'Otros'
    END AS category_name,
    ROW_NUMBER() OVER (PARTITION BY s.id) AS sort_order
  FROM sections s
) AS data
JOIN sections s ON data.section_id = s.id
ON CONFLICT (section_id, name) DO NOTHING;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profile_members_updated_at
BEFORE UPDATE ON profile_members
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();