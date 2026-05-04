-- Lista de compras, viajes y boletas (estructura usada por shopping.ts y receipts.ts).

CREATE TABLE public.shopping_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  store_name TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.shopping_trip_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.shopping_trips (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  quantity_planned NUMERIC NOT NULL DEFAULT 0,
  quantity_bought NUMERIC,
  unit_price_paid NUMERIC,
  is_checked BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (trip_id, product_id)
);

CREATE TABLE public.purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  store_name TEXT,
  purchased_at TIMESTAMPTZ,
  total NUMERIC,
  image_storage_path TEXT,
  raw_analysis JSONB,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'confirmed', 'rejected')),
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.purchase_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.purchase_receipts (id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products (id) ON DELETE SET NULL,
  name_raw TEXT NOT NULL,
  quantity NUMERIC,
  unit_price NUMERIC,
  line_total NUMERIC,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_shopping_trips_profile ON public.shopping_trips (profile_id);
CREATE INDEX idx_shopping_trip_items_trip ON public.shopping_trip_items (trip_id);
CREATE INDEX idx_purchase_receipts_profile ON public.purchase_receipts (profile_id);
CREATE INDEX idx_purchase_receipt_items_receipt ON public.purchase_receipt_items (receipt_id);

CREATE TRIGGER set_shopping_trips_updated_at
  BEFORE UPDATE ON public.shopping_trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_purchase_receipts_updated_at
  BEFORE UPDATE ON public.purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
