-- FOR ALL a veces complica INSERT con RLS; políticas explícitas por comando.

DROP POLICY IF EXISTS invitations_write_admin ON public.invitations;

CREATE POLICY invitations_insert_admin ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = invitations.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role = 'admin'
    )
  );

CREATE POLICY invitations_update_admin ON public.invitations FOR UPDATE TO authenticated
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

CREATE POLICY invitations_delete_admin ON public.invitations FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profile_members pm
      WHERE pm.profile_id = invitations.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
        AND pm.role = 'admin'
    )
  );
