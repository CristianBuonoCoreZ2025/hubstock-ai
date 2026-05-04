-- Aceptar invitaciones pendientes: la RLS solo permite a admins insertar en
-- profile_members; el invitado no podía unirse. Esta función corre como
-- SECURITY DEFINER y crea la membresía cuando el correo coincide.

CREATE OR REPLACE FUNCTION public.accept_pending_invitations_for_current_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.profile_members (profile_id, user_id, role, status)
  SELECT i.profile_id, auth.uid(), i.role, 'active'
  FROM public.invitations i
  INNER JOIN auth.users u ON u.id = auth.uid() AND lower(u.email) = lower(i.email)
  WHERE i.status = 'pending'
    AND i.expires_at > now()
  ON CONFLICT (profile_id, user_id) DO UPDATE
    SET
      status = 'active',
      role = excluded.role,
      updated_at = now();

  UPDATE public.invitations i
  SET status = 'accepted'
  FROM auth.users u
  WHERE u.id = auth.uid()
    AND lower(i.email) = lower(u.email)
    AND i.status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.profile_members pm
      WHERE pm.profile_id = i.profile_id
        AND pm.user_id = auth.uid()
        AND pm.status = 'active'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_pending_invitations_for_current_user() FROM public;
GRANT EXECUTE ON FUNCTION public.accept_pending_invitations_for_current_user() TO authenticated;

COMMENT ON FUNCTION public.accept_pending_invitations_for_current_user() IS
  'Crea profile_members para invitaciones pending cuyo email coincide con auth.users; marca accepted.';
