-- Create stock_checks table
CREATE TABLE stock_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  check_type TEXT NOT NULL CHECK (
    check_type IN ('initial_inventory', 'pre_shopping_check', 'quick_adjustment')
  ),
  zone TEXT NOT NULL CHECK (
    zone IN ('pantry', 'refrigerator', 'freezer', 'bathroom', 'laundry', 'storage', 'other')
  ),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'analyzing', 'pending_review', 'confirmed', 'cancelled')
  ),
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create stock_check_photos table
CREATE TABLE stock_check_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  stock_check_id UUID NOT NULL,
  storage_path TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (stock_check_id) REFERENCES stock_checks(id) ON DELETE CASCADE
);

-- Create stock_check_detected_items table
CREATE TABLE stock_check_detected_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  stock_check_id UUID NOT NULL,
  product_id UUID,
  raw_name TEXT,
  detected_name TEXT,
  brand TEXT,
  format TEXT,
  unit TEXT,
  visible_quantity NUMERIC DEFAULT 0,
  current_stock NUMERIC DEFAULT 0,
  suggested_stock NUMERIC DEFAULT 0,
  confidence NUMERIC,
  section_name TEXT,
  category_name TEXT,
  action TEXT NOT NULL DEFAULT 'review' CHECK (
    action IN ('create_product', 'adjust_stock', 'ignore', 'review', 'match_existing')
  ),
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (stock_check_id) REFERENCES stock_checks(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX idx_stock_checks_profile_id ON stock_checks(profile_id);
CREATE INDEX idx_stock_checks_profile_id_status ON stock_checks(profile_id, status);
CREATE INDEX idx_stock_checks_profile_id_check_type ON stock_checks(profile_id, check_type);
CREATE INDEX idx_stock_checks_created_at ON stock_checks(created_at);

CREATE INDEX idx_stock_check_photos_profile_id ON stock_check_photos(profile_id);
CREATE INDEX idx_stock_check_photos_stock_check_id ON stock_check_photos(stock_check_id);

CREATE INDEX idx_stock_check_detected_items_profile_id ON stock_check_detected_items(profile_id);
CREATE INDEX idx_stock_check_detected_items_stock_check_id ON stock_check_detected_items(stock_check_id);
CREATE INDEX idx_stock_check_detected_items_product_id ON stock_check_detected_items(product_id);
CREATE INDEX idx_stock_check_detected_items_action ON stock_check_detected_items(action);
CREATE INDEX idx_stock_check_detected_items_confirmed ON stock_check_detected_items(confirmed);

-- Create triggers for updated_at
CREATE TRIGGER update_stock_checks_updated_at
BEFORE UPDATE ON stock_checks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();