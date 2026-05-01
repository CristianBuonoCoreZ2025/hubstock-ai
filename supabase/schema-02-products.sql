-- Create products table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  section_id UUID NOT NULL,
  category_id UUID NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  format TEXT,
  unit TEXT,
  stock_current NUMERIC NOT NULL DEFAULT 0,
  stock_min NUMERIC DEFAULT 0,
  stock_ideal NUMERIC DEFAULT 0,
  reference_price NUMERIC,
  last_price NUMERIC,
  location TEXT,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create product_images table
CREATE TABLE product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  product_id UUID NOT NULL,
  storage_path TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Create stock_movements table
CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  product_id UUID NOT NULL,
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('initial', 'purchase', 'consumption', 'manual_adjustment',
    'stock_check_adjustment', 'receipt_import', 'correction')
  ),
  quantity NUMERIC NOT NULL,
  previous_stock NUMERIC,
  new_stock NUMERIC,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX idx_products_profile_id ON products(profile_id);
CREATE INDEX idx_products_profile_id_active ON products(profile_id, active);
CREATE INDEX idx_products_profile_id_name ON products(profile_id, name);
CREATE INDEX idx_products_section_id ON products(section_id);
CREATE INDEX idx_products_category_id ON products(category_id);

CREATE INDEX idx_product_images_profile_id ON product_images(profile_id);
CREATE INDEX idx_product_images_product_id ON product_images(product_id);

CREATE INDEX idx_stock_movements_profile_id ON stock_movements(profile_id);
CREATE INDEX idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_created_at ON stock_movements(created_at);

-- Create trigger for updated_at in products
CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();