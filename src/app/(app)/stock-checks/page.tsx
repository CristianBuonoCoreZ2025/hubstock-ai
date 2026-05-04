import { listProductsPicker } from '@/app/actions/receipts'
import {
  getStockChecksList,
  listMeasureUnits,
  listNetContentOptions,
  listProfileBrands,
  listProfilePresentations,
  listProfileProductTypes,
} from '@/app/actions/stock-checks'
import { getProfileContext } from '@/lib/profile/context'
import { StockChecksClient } from './StockChecksClient'

export default async function StockChecksPage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="app-page">
        <header className="app-page-header">
          <h1 className="app-page-title">Chequeos de stock</h1>
          <p className="app-page-lead">
            Necesitas un perfil activo para usar esta sección.
          </p>
        </header>
      </div>
    )
  }

  const [
    { data: checks, error: checksError },
    { data: products },
    { data: brands },
    { data: measureUnitsData, error: measureUnitsError },
    { data: netContentOptionsData, error: netContentOptionsError },
    { data: productTypesData, error: productTypesError },
    { data: presentationsData, error: presentationsError },
  ] = await Promise.all([
    getStockChecksList(),
    listProductsPicker(),
    listProfileBrands(),
    listMeasureUnits(),
    listNetContentOptions(),
    listProfileProductTypes(),
    listProfilePresentations(),
  ])

  const catalogHints = [
    measureUnitsError,
    netContentOptionsError,
    productTypesError,
    presentationsError,
  ].filter(Boolean)
  const catalogMerged =
    catalogHints.length > 0 ? [...new Set(catalogHints)].join(' · ') : null
  const listErrorMerged =
    [checksError, catalogMerged].filter(Boolean).join(' · ') || null

  return (
    <div className="app-page app-page-stock-wide">
      <header className="app-page-header">
        <h1 className="app-page-title">Chequeos de stock</h1>
        <p className="app-page-lead">
          Fotos por zona con detección asistida; los resultados quedan en
          estado pendiente de confirmación hasta que valides cantidades.
        </p>
      </header>

      <StockChecksClient
        profileId={activeProfileId}
        initialChecks={[...checks]}
        products={products ?? []}
        brands={brands ?? []}
        measureUnits={measureUnitsData ?? []}
        netContentOptions={netContentOptionsData ?? []}
        productTypes={productTypesData ?? []}
        presentations={presentationsData ?? []}
        listError={listErrorMerged}
      />
    </div>
  )
}
