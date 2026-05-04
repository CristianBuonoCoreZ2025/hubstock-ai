-- -----------------------------------------------------------------------------
-- Encaminar una base EXISTENTE (sin borrar proyecto ni datos) al modelo único
-- descrito en supabase/schema-01-core.sql … schema-05-rls.sql.
--
-- Idempotente: usar ADD COLUMN IF NOT EXISTS, CREATE IF NOT EXISTS, DROP POLICY IF EXISTS.
-- Ejecutar con: supabase db push (proyecto linkado) o pegar en SQL Editor una vez.
--
-- NO sustituye una instalación vacía: ahí usa schema-01…05 en orden o schema-all.sql.
-- -----------------------------------------------------------------------------

-- --- Columnas de IA y corrección de chequeos (integra 20260503 + 20260504 + 20260505) ---
ALTER TABLE public.stock_checks
  ADD COLUMN IF NOT EXISTS ai_meta JSONB;

COMMENT ON COLUMN public.stock_checks.ai_meta IS
  'IA: vision {provider, model, providerLabel}, confidenceAvg, confidenceMin, detectedCount, confidenceCoverage';

ALTER TABLE public.stock_check_detected_items
  ADD COLUMN IF NOT EXISTS brand_guess TEXT,
  ADD COLUMN IF NOT EXISTS product_type_guess TEXT,
  ADD COLUMN IF NOT EXISTS presentation_guess TEXT,
  ADD COLUMN IF NOT EXISTS net_quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS net_unit TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.stock_check_detected_items.brand_guess IS 'Marca inferida por IA o corregida';

ALTER TABLE public.stock_check_detected_items
  ADD COLUMN IF NOT EXISTS marked_invalid BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.stock_check_detected_items.marked_invalid IS 'true = descartar línea (lectura incorrecta)';

-- --- Índice opcional alineado con schema-02 (no rompe si ya existe) ---
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at
  ON public.stock_movements (created_at);

-- --- Tabla profile_brands + RLS (integra 20260505120000_profile_brands_and_invalid.sql) ---
CREATE TABLE IF NOT EXISTS public.profile_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profile_brands_profile_name_unique UNIQUE (profile_id, name)
);

CREATE INDEX IF NOT EXISTS idx_profile_brands_profile ON public.profile_brands (profile_id);

ALTER TABLE public.profile_brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_brands_select_member ON public.profile_brands;
CREATE POLICY profile_brands_select_member ON public.profile_brands FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_brands.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS profile_brands_write_editor ON public.profile_brands;
CREATE POLICY profile_brands_write_editor ON public.profile_brands FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_brands.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS profile_brands_delete_editor ON public.profile_brands;
CREATE POLICY profile_brands_delete_editor ON public.profile_brands FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_brands.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

-- --- Política INSERT stock_checks (integra 20260502100000_fix_stock_checks_insert_rls.sql) ---
DROP POLICY IF EXISTS stock_checks_write_editor ON public.stock_checks;

CREATE POLICY stock_checks_write_editor ON public.stock_checks FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

-- Lectura de líneas para todos los miembros (ver también 20260508140000_stock_check_detected_select_members.sql)
DROP POLICY IF EXISTS stock_check_detected_select_member ON public.stock_check_detected_items;

CREATE POLICY stock_check_detected_select_member ON public.stock_check_detected_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.stock_checks sc
      JOIN public.profile_members pm ON pm.profile_id = sc.profile_id
      WHERE sc.id = stock_check_detected_items.stock_check_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );
