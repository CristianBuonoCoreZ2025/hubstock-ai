-- Create shopping_trips table
CREATE TABLE shopping_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'active', 'completed', 'cancelled')
  ),
  store_name TEXT,
  estimated_total NUMERIC DEFAULT 0,
  real_total NUMERIC DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create shopping_trip_items table
CREATE TABLE shopping_trip_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  shopping_trip_id UUID NOT NULL,
  product_id UUID,
  suggested_quantity NUMERIC DEFAULT 0,
  purchased_quantity NUMERIC DEFAULT 0,
  estimated_price NUMERIC,
  real_price NUMERIC,
  checked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (shopping_trip_id) REFERENCES shopping_trips(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- Create purchase_receipts table
CREATE TABLE purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  shopping_trip_id UUID,
  store_name TEXT,
  purchase_date DATE NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CLP' CHECK (
    currency IN ('CLP', 'USD', 'EUR')
  ),
  storage_path TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (
    status IN ('pending_review', 'confirmed', 'rejected', 'processed')
  ),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (shopping_trip_id) REFERENCES shopping_trips(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create purchase_receipt_items table
CREATE TABLE purchase_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  purchase_receipt_id UUID NOT NULL,
  product_id UUID,
  raw_name TEXT,
  product_name TEXT,
  brand TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price NUMERIC,
  total_price NUMERIC,
  confidence NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (purchase_receipt_id) REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX idx_shopping_trips_profile_id ON shopping_trips(profile_id);
CREATE INDEX idx_shopping_trips_profile_id_status ON shopping_trips(profile_id, status);
CREATE INDEX idx_shopping_trips_created_at ON shopping_trips(created_at);

CREATE INDEX idx_shopping_trip_items_profile_id ON shopping_trip_items(profile_id);
CREATE INDEX idx_shopping_trip_items_shopping_trip_id ON shopping_trip_items(shopping_trip_id);
CREATE INDEX idx_shopping_trip_items_product_id ON shopping_trip_items(product_id);

CREATE INDEX idx_purchase_receipts_profile_id ON purchase_receipts(profile_id);
CREATE INDEX idx_purchase_receipts_shopping_trip_id ON purchase_receipts(shopping_trip_id);
CREATE INDEX idx_purchase_receipts_status ON purchase_receipts(status);
CREATE INDEX idx_purchase_receipts_purchase_date ON purchase_receipts(purchase_date);

CREATE INDEX idx_purchase_receipt_items_profile_id ON purchase_receipt_items(profile_id);
CREATE INDEX idx_purchase_receipt_items_purchase_receipt_id ON purchase_receipt_items(purchase_receipt_id);
CREATE INDEX idx_purchase_receipt_items_product_id ON purchase_receipt_items(product_id);

-- Create triggers for updated_at
CREATE TRIGGER update_shopping_trips_updated_at
BEFORE UPDATE ON shopping_trips
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shopping_trip_items_updated_at
BEFORE UPDATE ON shopping_trip_items
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purchase_receipts_updated_at
BEFORE UPDATE ON purchase_receipts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();