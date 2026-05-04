-- Row Level Security y políticas alineadas con la app (cliente autenticado + roles por hogar).

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_trip_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_check_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_check_detected_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_measure_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_net_content_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_product_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_presentations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_member ON public.profiles;
CREATE POLICY profiles_select_member ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profiles.id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS profiles_insert_authenticated ON public.profiles;
CREATE POLICY profiles_insert_authenticated ON public.profiles FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin ON public.profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profiles.id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role = 'admin'
    )
  );

DROP POLICY IF EXISTS profile_members_select_same_profile ON public.profile_members;
CREATE POLICY profile_members_select_same_profile ON public.profile_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_members.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS profile_members_insert_admin ON public.profile_members;
CREATE POLICY profile_members_insert_admin ON public.profile_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_members.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role = 'admin'
    )
  );

DROP POLICY IF EXISTS profile_members_update_admin ON public.profile_members;
CREATE POLICY profile_members_update_admin ON public.profile_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = profile_members.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role = 'admin'
    )
  );

DROP POLICY IF EXISTS invitations_select_admin ON public.invitations;
CREATE POLICY invitations_select_admin ON public.invitations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = invitations.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role = 'admin'
    )
  );

DROP POLICY IF EXISTS invitations_write_admin ON public.invitations;
CREATE POLICY invitations_write_admin ON public.invitations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = invitations.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = invitations.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role = 'admin'
    )
  );

DROP POLICY IF EXISTS sections_select_authenticated ON public.sections;
CREATE POLICY sections_select_authenticated ON public.sections FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS categories_select_authenticated ON public.categories;
CREATE POLICY categories_select_authenticated ON public.categories FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS products_select_member ON public.products;
CREATE POLICY products_select_member ON public.products FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = products.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS products_insert_editor ON public.products;
CREATE POLICY products_insert_editor ON public.products FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = products.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS products_update_editor ON public.products;
CREATE POLICY products_update_editor ON public.products FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = products.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS products_delete_admin ON public.products;
CREATE POLICY products_delete_admin ON public.products FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = products.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role = 'admin'
    )
  );

DROP POLICY IF EXISTS product_images_select_member ON public.product_images;
CREATE POLICY product_images_select_member ON public.product_images FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = product_images.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS product_images_insert_editor ON public.product_images;
CREATE POLICY product_images_insert_editor ON public.product_images FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = product_images.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS product_images_update_editor ON public.product_images;
CREATE POLICY product_images_update_editor ON public.product_images FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = product_images.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS product_images_delete_editor ON public.product_images;
CREATE POLICY product_images_delete_editor ON public.product_images FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = product_images.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS stock_movements_select_member ON public.stock_movements;
CREATE POLICY stock_movements_select_member ON public.stock_movements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = stock_movements.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS stock_movements_insert_editor ON public.stock_movements;
CREATE POLICY stock_movements_insert_editor ON public.stock_movements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = stock_movements.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS shopping_trips_select_member ON public.shopping_trips;
CREATE POLICY shopping_trips_select_member ON public.shopping_trips FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = shopping_trips.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS shopping_trips_insert_editor ON public.shopping_trips;
CREATE POLICY shopping_trips_insert_editor ON public.shopping_trips FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = shopping_trips.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS shopping_trips_update_editor ON public.shopping_trips;
CREATE POLICY shopping_trips_update_editor ON public.shopping_trips FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = shopping_trips.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS shopping_trips_delete_editor ON public.shopping_trips;
CREATE POLICY shopping_trips_delete_editor ON public.shopping_trips FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = shopping_trips.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS shopping_trip_items_select_member ON public.shopping_trip_items;
CREATE POLICY shopping_trip_items_select_member ON public.shopping_trip_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.shopping_trips t
      JOIN public.profile_members pm ON pm.profile_id = t.profile_id
      WHERE t.id = shopping_trip_items.trip_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS shopping_trip_items_write_editor ON public.shopping_trip_items;
CREATE POLICY shopping_trip_items_write_editor ON public.shopping_trip_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.shopping_trips t
      JOIN public.profile_members pm ON pm.profile_id = t.profile_id
      WHERE t.id = shopping_trip_items.trip_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS shopping_trip_items_update_editor ON public.shopping_trip_items;
CREATE POLICY shopping_trip_items_update_editor ON public.shopping_trip_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.shopping_trips t
      JOIN public.profile_members pm ON pm.profile_id = t.profile_id
      WHERE t.id = shopping_trip_items.trip_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS shopping_trip_items_delete_editor ON public.shopping_trip_items;
CREATE POLICY shopping_trip_items_delete_editor ON public.shopping_trip_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.shopping_trips t
      JOIN public.profile_members pm ON pm.profile_id = t.profile_id
      WHERE t.id = shopping_trip_items.trip_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS purchase_receipts_select_member ON public.purchase_receipts;
CREATE POLICY purchase_receipts_select_member ON public.purchase_receipts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = purchase_receipts.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS purchase_receipts_insert_editor ON public.purchase_receipts;
CREATE POLICY purchase_receipts_insert_editor ON public.purchase_receipts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = purchase_receipts.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS purchase_receipts_update_editor ON public.purchase_receipts;
CREATE POLICY purchase_receipts_update_editor ON public.purchase_receipts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = purchase_receipts.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS purchase_receipts_delete_editor ON public.purchase_receipts;
CREATE POLICY purchase_receipts_delete_editor ON public.purchase_receipts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = purchase_receipts.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS purchase_receipt_items_select_member ON public.purchase_receipt_items;
CREATE POLICY purchase_receipt_items_select_member ON public.purchase_receipt_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.purchase_receipts r
      JOIN public.profile_members pm ON pm.profile_id = r.profile_id
      WHERE r.id = purchase_receipt_items.receipt_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

DROP POLICY IF EXISTS purchase_receipt_items_write_editor ON public.purchase_receipt_items;
CREATE POLICY purchase_receipt_items_write_editor ON public.purchase_receipt_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.purchase_receipts r
      JOIN public.profile_members pm ON pm.profile_id = r.profile_id
      WHERE r.id = purchase_receipt_items.receipt_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS purchase_receipt_items_update_editor ON public.purchase_receipt_items;
CREATE POLICY purchase_receipt_items_update_editor ON public.purchase_receipt_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.purchase_receipts r
      JOIN public.profile_members pm ON pm.profile_id = r.profile_id
      WHERE r.id = purchase_receipt_items.receipt_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS purchase_receipt_items_delete_editor ON public.purchase_receipt_items;
CREATE POLICY purchase_receipt_items_delete_editor ON public.purchase_receipt_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.purchase_receipts r
      JOIN public.profile_members pm ON pm.profile_id = r.profile_id
      WHERE r.id = purchase_receipt_items.receipt_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS stock_checks_select_member ON public.stock_checks;
CREATE POLICY stock_checks_select_member ON public.stock_checks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = stock_checks.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    )
  );

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

DROP POLICY IF EXISTS stock_checks_update_editor ON public.stock_checks;
CREATE POLICY stock_checks_update_editor ON public.stock_checks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = stock_checks.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS stock_check_photos_via_check ON public.stock_check_photos;
CREATE POLICY stock_check_photos_via_check ON public.stock_check_photos FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.stock_checks sc
      JOIN public.profile_members pm ON pm.profile_id = sc.profile_id
      WHERE sc.id = stock_check_photos.stock_check_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.stock_checks sc
      JOIN public.profile_members pm ON pm.profile_id = sc.profile_id
      WHERE sc.id = stock_check_photos.stock_check_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS stock_check_detected_via_check ON public.stock_check_detected_items;
CREATE POLICY stock_check_detected_via_check ON public.stock_check_detected_items FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.stock_checks sc
      JOIN public.profile_members pm ON pm.profile_id = sc.profile_id
      WHERE sc.id = stock_check_detected_items.stock_check_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.stock_checks sc
      JOIN public.profile_members pm ON pm.profile_id = sc.profile_id
      WHERE sc.id = stock_check_detected_items.stock_check_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS stock_check_detected_select_member ON public.stock_check_detected_items;
CREATE POLICY stock_check_detected_select_member ON public.stock_check_detected_items FOR SELECT
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

DROP POLICY IF EXISTS stock_measure_units_select_auth ON public.stock_measure_units;
CREATE POLICY stock_measure_units_select_auth ON public.stock_measure_units
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS stock_net_content_options_select_auth ON public.stock_net_content_options;
CREATE POLICY stock_net_content_options_select_auth ON public.stock_net_content_options
  FOR SELECT TO authenticated USING (true);

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
