import { getCategoriesAndSections } from '@/app/actions/inventory'
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

  const [
    { data: receipts, error },
    { data: products },
    { categories, sections, error: taxError },
  ] = await Promise.all([
    getPurchaseReceipts(),
    listProductsPicker(),
    getCategoriesAndSections(),
  ])

  const listError =
    [error, taxError].filter(Boolean).join(' · ') || null

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
        categories={(categories ?? []) as { id: string; name: string; section_id: string }[]}
        sections={(sections ?? []) as { id: string; name: string }[]}
        listError={listError}
      />
    </div>
  )
}
