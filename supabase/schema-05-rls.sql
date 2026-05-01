-- Enable Row Level Security for all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_trip_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_check_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_check_detected_items ENABLE ROW LEVEL SECURITY;

-- Create helper functions
CREATE OR REPLACE FUNCTION public.is_profile_member(p_profile_id uuid)
RETURNS boolean AS $$  SELECT EXISTS (
    SELECT 1 FROM profile_members
    WHERE profile_id = p_profile_id
    AND user_id = auth.uid()
    AND status = 'active'
  );$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.has_profile_role(p_profile_id uuid, allowed_roles text[])
RETURNS boolean AS $$  SELECT EXISTS (
    SELECT 1 FROM profile_members
    WHERE profile_id = p_profile_id
    AND user_id = auth.uid()
    AND status = 'active'
    AND role = ANY(allowed_roles)
  );$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_profile_admin_or_editor(p_profile_id uuid)
RETURNS boolean AS $$  SELECT has_profile_role(p_profile_id, ARRAY['admin', 'editor']);$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_profile_admin(p_profile_id uuid)
RETURNS boolean AS $$  SELECT has_profile_role(p_profile_id, ARRAY['admin']);$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Set search_path for all functions
ALTER FUNCTION public.is_profile_member(uuid) SET search_path = public;
ALTER FUNCTION public.has_profile_role(uuid, text[]) SET search_path = public;
ALTER FUNCTION public.is_profile_admin_or_editor(uuid) SET search_path = public;
ALTER FUNCTION public.is_profile_admin(uuid) SET search_path = public;

-- Create policies for profiles
DROP POLICY IF EXISTS profiles_select_policy ON profiles;
CREATE POLICY profiles_select_policy ON profiles
  FOR SELECT
  USING (is_profile_member(id));

DROP POLICY IF EXISTS profiles_insert_policy ON profiles;
CREATE POLICY profiles_insert_policy ON profiles
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS profiles_update_policy ON profiles;
CREATE POLICY profiles_update_policy ON profiles
  FOR UPDATE
  USING (is_profile_admin(id));

DROP POLICY IF EXISTS profiles_delete_policy ON profiles;
CREATE POLICY profiles_delete_policy ON profiles
  FOR DELETE
  USING (is_profile_admin(id));

-- Create policies for profile_members
DROP POLICY IF EXISTS profile_members_select_policy ON profile_members;
CREATE POLICY profile_members_select_policy ON profile_members
  FOR SELECT
  USING (is_profile_member(profile_id));

DROP POLICY IF EXISTS profile_members_insert_policy ON profile_members;
CREATE POLICY profile_members_insert_policy ON profile_members
  FOR INSERT
  WITH CHECK (is_profile_admin(profile_id));

DROP POLICY IF EXISTS profile_members_update_policy ON profile_members;
CREATE POLICY profile_members_update_policy ON profile_members
  FOR UPDATE
  USING (is_profile_admin(profile_id));

DROP POLICY IF EXISTS profile_members_delete_policy ON profile_members;
CREATE POLICY profile_members_delete_policy ON profile_members
  FOR DELETE
  USING (is_profile_admin(profile_id));

-- Create policies for sections
DROP POLICY IF EXISTS sections_select_policy ON sections;
CREATE POLICY sections_select_policy ON sections
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Create policies for categories
DROP POLICY IF EXISTS categories_select_policy ON categories;
CREATE POLICY categories_select_policy ON categories
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Create policies for products
DROP POLICY IF EXISTS products_select_policy ON products;
CREATE POLICY products_select_policy ON products
  FOR SELECT
  USING (is_profile_member(profile_id));

DROP POLICY IF EXISTS products_insert_policy ON products;
CREATE POLICY products_insert_policy ON products
  FOR INSERT
  WITH CHECK (is_profile_admin_or_editor(profile_id));

DROP POLICY IF EXISTS products_update_policy ON products;
CREATE POLICY products_update_policy ON products
  FOR UPDATE
  USING (is_profile_admin_or_editor(profile_id));

DROP POLICY IF EXISTS products_delete_policy ON products;
CREATE POLICY products_delete_policy ON products
  FOR DELETE
  USING (is_profile_admin(profile_id));

-- Create policies for product_images
DROP POLICY IF EXISTS product_images_select_policy ON product_images;
CREATE POLICY product_images_select_policy ON product_images
  FOR SELECT
  USING (is_profile_member(profile_id));

DROP POLICY IF EXISTS product_images_insert_policy ON product_images;
CREATE POLICY product_images_insert_policy ON product_images
  FOR INSERT
  WITH CHECK (is_profile_admin_or_editor(profile_id));

DROP POLICY IF EXISTS product_images_update_policy ON product_images;
CREATE POLICY product_images_update_policy ON product_images
  FOR UPDATE
  USING (is_profile_admin_or_editor(profile_id));

DROP POLICY IF EXISTS product_images_delete_policy ON product_images;
CREATE POLICY product_images_delete_policy ON product_images
  FOR DELETE
  USING (is_profile_admin_or_editor(profile_id));

-- Create policies for stock_movements
DROP POLICY IF EXISTS stock_movements_select_policy ON stock_movements;
CREATE POLICY stock_movements_select_policy ON stock_movements
  FOR SELECT
  USING (is_profile_member(profile_id));

DROP POLICY IF EXISTS stock_movements_insert_policy ON stock_movements;
CREATE POLICY stock_movements_insert_policy ON stock_movements
  FOR INSERT
  WITH CHECK (is_profile_admin_or_editor(profile_id));

DROP POLICY IF EXISTS stock_movements_delete_policy ON stock_movements;
CREATE POLICY stock_movements_delete_policy ON stock_movements
  FOR DELETE
  USING (is_profile_admin(profile_id));

-- Create policies for shopping_trips
DROP POLICY IF EXISTS shopping_trips_select_policy ON shopping_trips;
CREATE POLICY shopping_trips_select_policy ON