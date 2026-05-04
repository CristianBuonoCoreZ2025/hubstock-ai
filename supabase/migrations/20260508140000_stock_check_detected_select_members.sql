-- Antes: solo la política "stock_check_detected_via_check" (FOR ALL) permitía ver líneas
-- a admin/editor. Los miembros con rol viewer obtenían 0 filas al cargar el chequeo.
-- Esta política solo SELECT permite que cualquier miembro activo del hogar vea las líneas;
-- insert/update/delete siguen gobernados por la política existente para editores.

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
