import { getTeamData } from '@/app/actions/team'
import { TeamPageClient } from './TeamPageClient'

export default async function UsersPage() {
  const { members, invitations, error, isAdmin } = await getTeamData()

  if (error) {
    return (
      <div className="app-page">
        <p className="app-page-lead text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <TeamPageClient
      members={members as never}
      invitations={invitations as never}
      isAdmin={isAdmin}
    />
  )
}
