-- Catálogos para desplegables en chequeo de stock (unidades globales; tipos y presentaciones por hogar).

-- Unidades de medida (contenido neto / empaque)
CREATE TABLE IF NOT EXISTS public.stock_measure_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO public.stock_measure_units (code, label, sort_order)
SELECT v.code, v.label, v.sort_order
FROM (
  VALUES
    ('g', 'g (gramos)', 10),
    ('kg', 'kg', 20),
    ('mg', 'mg', 30),
    ('ml', 'ml', 40),
    ('L', 'L (litros)', 50),
    ('cl', 'cl', 60),
    ('ud', 'ud. (unidad)', 70),
    ('paq', 'Paquete', 80)
) AS v(code, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_measure_units u WHERE u.code = v.code
);

ALTER TABLE public.stock_measure_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_measure_units_select_auth ON public.stock_measure_units;
CREATE POLICY stock_measure_units_select_auth ON public.stock_measure_units
  FOR SELECT TO authenticated USING (true);

-- Opciones frecuentes de contenido neto (cantidad + unidad)
CREATE TABLE IF NOT EXISTS public.stock_net_content_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  net_quantity NUMERIC NOT NULL,
  unit_code TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO public.stock_net_content_options (label, net_quantity, unit_code, sort_order)
SELECT v.label, v.net_quantity, v.unit_code, v.sort_order
FROM (
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
    ('2 L', 2, 'L', 100)
) AS v(label, net_quantity, unit_code, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_net_content_options o WHERE o.label = v.label
);

ALTER TABLE public.stock_net_content_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_net_content_options_select_auth ON public.stock_net_content_options;
CREATE POLICY stock_net_content_options_select_auth ON public.stock_net_content_options
  FOR SELECT TO authenticated USING (true);

-- Tipos de producto por hogar (ej. leche, arroz)
CREATE TABLE IF NOT EXISTS public.profile_product_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, name)
);

CREATE INDEX IF NOT EXISTS idx_profile_product_types_profile
  ON public.profile_product_types (profile_id);

ALTER TABLE public.profile_product_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_product_types_select_member ON public.profile_product_types;
CREATE POLICY profile_product_types_select_member ON public.profile_product_types FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_product_types.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS profile_product_types_write_editor ON public.profile_product_types;
CREATE POLICY profile_product_types_write_editor ON public.profile_product_types FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_product_types.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS profile_product_types_delete_editor ON public.profile_product_types;
CREATE POLICY profile_product_types_delete_editor ON public.profile_product_types FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_product_types.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

-- Presentaciones por hogar (ej. bolsa, botella)
CREATE TABLE IF NOT EXISTS public.profile_presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, name)
);

CREATE INDEX IF NOT EXISTS idx_profile_presentations_profile
  ON public.profile_presentations (profile_id);

ALTER TABLE public.profile_presentations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_presentations_select_member ON public.profile_presentations;
CREATE POLICY profile_presentations_select_member ON public.profile_presentations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_presentations.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS profile_presentations_write_editor ON public.profile_presentations;
CREATE POLICY profile_presentations_write_editor ON public.profile_presentations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_presentations.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS profile_presentations_delete_editor ON public.profile_presentations;
CREATE POLICY profile_presentations_delete_editor ON public.profile_presentations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_presentations.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );
