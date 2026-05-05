import { getTeamData } from '@/app/actions/team'
import { getProfileContext } from '@/lib/profile/context'
import { TeamPageClient } from './TeamPageClient'

export default async function UsersPage() {
  const { profiles, activeProfileId } = await getProfileContext()
  const { members, invitations, adminProfileIds, error, isAdmin } = await getTeamData()

  if (error) {
    return (
      <div className="app-page">
        <p className="app-page-lead text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <TeamPageClient
      profiles={profiles as never}
      activeProfileId={activeProfileId}
      members={members as never}
      invitations={invitations as never}
      adminProfileIds={adminProfileIds}
      isAdmin={isAdmin}
    />
  )
}
