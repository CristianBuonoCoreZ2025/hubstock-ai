-- Create invitations table
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN ('admin', 'editor', 'viewer')
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled')
  ),
  invited_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX idx_invitations_profile_id ON invitations(profile_id);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_status ON invitations(status);
CREATE INDEX idx_invitations_profile_id_email ON invitations(profile_id, email);
CREATE INDEX idx_invitations_invited_by ON invitations(invited_by);

-- Enable Row Level Security
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Create trigger for updated_at
CREATE TRIGGER update_invitations_updated_at
BEFORE UPDATE ON invitations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create policies for invitations
DROP POLICY IF EXISTS invitations_select_policy ON invitations;
CREATE POLICY invitations_select_policy ON invitations
  FOR SELECT
  USING (
    is_profile_admin(profile_id) OR
    (auth.uid() IS NOT NULL AND email = auth.email())
  );

DROP POLICY IF EXISTS invitations_insert_policy ON invitations;
CREATE POLICY invitations_insert_policy ON invitations
  FOR INSERT
  WITH CHECK (is_profile_admin(profile_id));

DROP POLICY IF EXISTS invitations_update_policy ON invitations;
CREATE POLICY invitations_update_policy ON invitations
  FOR UPDATE
  USING (is_profile_admin(profile_id));

DROP POLICY IF EXISTS invitations_delete_policy ON invitations;
CREATE POLICY invitations_delete_policy ON invitations
  FOR DELETE
  USING (is_profile_admin(profile_id));