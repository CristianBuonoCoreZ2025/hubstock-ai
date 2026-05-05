import { getPurchaseReceipts, listProductsPicker } from '@/app/actions/receipts'
import { PAGE_LEADS } from '@/lib/domain'
import { getProfileContext } from '@/lib/profile/context'
import { ReceiptsClient } from './ReceiptsClient'

export default async function ReceiptsPage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="app-page">
        <header className="app-page-header">
          <h1 className="app-page-title">Boletas</h1>
          <p className="app-page-lead">
            Necesitas un perfil activo para gestionar boletas.
          </p>
        </header>
      </div>
    )
  }

  const [{ data: receipts, error }, { data: products }] = await Promise.all([
    getPurchaseReceipts(),
    listProductsPicker(),
  ])

  return (
    <div className="app-page">
      <header className="app-page-header">
        <h1 className="app-page-title">Boletas</h1>
        <p className="app-page-lead">{PAGE_LEADS.receipts}</p>
      </header>

      <ReceiptsClient
        profileId={activeProfileId}
        initialReceipts={[...receipts]}
        products={products ?? []}
        listError={error}
      />
    </div>
  )
}
