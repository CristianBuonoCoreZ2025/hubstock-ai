-- Inventario: productos, imágenes y movimientos de stock (delta + movement_type).

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES public.sections (id) ON DELETE RESTRICT,
  category_id UUID NOT NULL REFERENCES public.categories (id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  brand TEXT,
  format TEXT,
  unit TEXT,
  stock_current NUMERIC NOT NULL DEFAULT 0,
  stock_min NUMERIC,
  stock_ideal NUMERIC,
  reference_price NUMERIC,
  last_price NUMERIC,
  location TEXT,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  delta NUMERIC NOT NULL,
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('consumption', 'purchase', 'adjustment', 'import', 'inventory_count')
  ),
  note TEXT,
  reference_id UUID,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_profile ON public.products (profile_id);
CREATE INDEX idx_products_section ON public.products (section_id);
CREATE INDEX idx_products_category ON public.products (category_id);
CREATE INDEX idx_product_images_profile ON public.product_images (profile_id);
CREATE INDEX idx_product_images_product ON public.product_images (product_id);
CREATE INDEX idx_stock_movements_profile ON public.stock_movements (profile_id);
CREATE INDEX idx_stock_movements_product ON public.stock_movements (product_id);
CREATE INDEX idx_stock_movements_created_at ON public.stock_movements (created_at);

CREATE TRIGGER set_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
