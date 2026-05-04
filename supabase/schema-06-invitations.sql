-- Create invitations table
CREATE TABLE IF NOT EXISTS public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'expired', 'revoked')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_invitations_profile_id ON public.invitations(profile_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON public.invitations(status);
CREATE INDEX IF NOT EXISTS idx_invitations_profile_id_email ON public.invitations(profile_id, email);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON public.invitations(invited_by);

-- Enable Row Level Security
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Create policies for invitations
DROP POLICY IF EXISTS invitations_select_policy ON public.invitations;
DROP POLICY IF EXISTS "invitations_select_admin" ON public.invitations;
CREATE POLICY "invitations_select_admin" ON public.invitations
  FOR SELECT
  TO authenticated
  USING (private.has_profile_role(profile_id, ARRAY['admin']));

DROP POLICY IF EXISTS invitations_insert_policy ON public.invitations;
DROP POLICY IF EXISTS invitations_update_policy ON public.invitations;
DROP POLICY IF EXISTS invitations_delete_policy ON public.invitations;
DROP POLICY IF EXISTS "invitations_write_admin" ON public.invitations;
CREATE POLICY "invitations_write_admin" ON public.invitations
  FOR ALL
  TO authenticated
  USING (private.has_profile_role(profile_id, ARRAY['admin']))
  WITH CHECK (private.has_profile_role(profile_id, ARRAY['admin']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated, service_role;