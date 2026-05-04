-- Chequeos de stock con metadatos de IA y corrección de líneas (incluye profile_brands).

CREATE TABLE public.stock_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  zone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'processing', 'awaiting_confirmation', 'completed')
  ),
  ai_meta JSONB,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.stock_checks.ai_meta IS
  'IA: vision {provider, model, providerLabel}, confidenceAvg, confidenceMin, detectedCount, confidenceCoverage';

CREATE TABLE public.stock_check_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_check_id UUID NOT NULL REFERENCES public.stock_checks (id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.stock_check_detected_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_check_id UUID NOT NULL REFERENCES public.stock_checks (id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products (id) ON DELETE SET NULL,
  name_guess TEXT NOT NULL,
  brand_guess TEXT,
  product_type_guess TEXT,
  presentation_guess TEXT,
  net_quantity NUMERIC,
  net_unit TEXT,
  notes TEXT,
  quantity_guess NUMERIC,
  confidence NUMERIC,
  accepted BOOLEAN,
  marked_invalid BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.stock_check_detected_items.brand_guess IS 'Marca inferida o corregida';
COMMENT ON COLUMN public.stock_check_detected_items.marked_invalid IS 'true = descartar línea (lectura incorrecta)';

CREATE TABLE public.profile_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, name)
);

-- Catálogos UI chequeo de stock (alineado con migration 20260510120000_stock_scan_dropdown_catalogs.sql)

CREATE TABLE public.stock_measure_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO public.stock_measure_units (code, label, sort_order)
VALUES
  ('g', 'g (gramos)', 10),
  ('kg', 'kg', 20),
  ('mg', 'mg', 30),
  ('ml', 'ml', 40),
  ('L', 'L (litros)', 50),
  ('cl', 'cl', 60),
  ('ud', 'ud. (unidad)', 70),
  ('paq', 'Paquete', 80);

CREATE TABLE public.stock_net_content_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  net_quantity NUMERIC NOT NULL,
  unit_code TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO public.stock_net_content_options (label, net_quantity, unit_code, sort_order)
VALUES
  ('100 g', 100, 'g', 10),
  ('250 g', 250, 'g', 20),
  ('500 g', 500, 'g', 30),
  ('1 kg', 1, 'kg', 40),
  ('200 ml', 200, 'ml', 50),
  ('500 ml', 500, 'ml', 60),
  ('750 ml', 750, 'ml', 70),
  ('1 L', 1, 'L', 80),
  ('1,5 L', 1.5, 'L', 90),
  ('2 L', 2, 'L', 100);

CREATE TABLE public.profile_product_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, name)
);

CREATE TABLE public.profile_presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, name)
);

CREATE INDEX idx_profile_product_types_profile ON public.profile_product_types (profile_id);
CREATE INDEX idx_profile_presentations_profile ON public.profile_presentations (profile_id);

CREATE INDEX idx_stock_checks_profile ON public.stock_checks (profile_id);
CREATE INDEX idx_stock_check_photos_check ON public.stock_check_photos (stock_check_id);
CREATE INDEX idx_stock_check_detected_check ON public.stock_check_detected_items (stock_check_id);
CREATE INDEX idx_profile_brands_profile ON public.profile_brands (profile_id);

CREATE TRIGGER set_stock_checks_updated_at
  BEFORE UPDATE ON public.stock_checks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
