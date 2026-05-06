import Link from 'next/link'
import { CopyCatalogButton } from '@/components/catalog/CopyCatalogButton'
import { createClient } from '@/lib/supabase/server'
import { PAGE_LEADS } from '@/lib/domain'
import { getProfileContext } from '@/lib/profile/context'

type CatalogMediaRow = { public_url: string; kind: string }

function thumbnailPublicUrl(media: CatalogMediaRow[] | null | undefined): string | null {
  return media?.find((m) => m.kind === 'thumbnail')?.public_url ?? null
}

export default async function CatalogPage() {
  const { activeProfileId, profiles } = await getProfileContext()

  if (!activeProfileId || profiles.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Catálogo</h1>
        <p className="text-sm text-muted-foreground">
          Necesitas un perfil activo para usar el catálogo.
        </p>
      </div>
    )
  }

  const supabase = await createClient()

  const [{ data: catalogRows, error: catalogError }, { data: sections }, { data: categories }] =
    await Promise.all([
      supabase
        .from('catalog_products')
        .select(
          'id, name, brand, format, unit, default_reference_price, sort_order, section_id, category_id, catalog_product_media(public_url, kind)'
        )
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      supabase.from('sections').select('id, name, sort_order'),
      supabase.from('categories').select('id, name, section_id, sort_order').order('sort_order'),
    ])

  const sectionById = new Map((sections ?? []).map((s) => [s.id, s]))
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]))

  const { count: linkedCount, error: countError } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', activeProfileId)
    .not('catalog_product_id', 'is', null)

  type CatalogRow = {
    id: string
    name: string
    brand: string | null
    format: string | null
    unit: string | null
    default_reference_price: number | null
    sort_order: number
    section_id: string
    category_id: string
    catalog_product_media: CatalogMediaRow[] | null
  }

  const rows = (catalogRows ?? []) as CatalogRow[]

  const sortedRows = [...rows].sort((a, b) => {
    const sa = sectionById.get(a.section_id)?.sort_order ?? 0
    const sb = sectionById.get(b.section_id)?.sort_order ?? 0
    if (sa !== sb) return sa - sb
    return a.sort_order - b.sort_order
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Catálogo</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{PAGE_LEADS.catalogMaster}</p>
        </div>
        <CopyCatalogButton profileId={activeProfileId} />
      </div>

      <p className="text-sm text-muted-foreground">
        En tu perfil hay{' '}
        <span className="font-medium text-foreground">
          {countError != null ? '—' : String(linkedCount ?? 0)}
        </span>{' '}
        productos vinculados al catálogo maestro.{' '}
        <Link href="/inventory" className="font-medium text-primary underline underline-offset-2">
          Ver inventario
        </Link>
      </p>

      {catalogError != null ? (
        <p className="text-sm text-destructive">
          Error al cargar el catálogo: {catalogError.message}
        </p>
      ) : sortedRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aún no hay filas en el catálogo maestro. Ejecuta la migración SQL en Supabase.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="p-3 font-medium w-14"> </th>
                <th className="p-3 font-medium">Sección</th>
                <th className="p-3 font-medium">Categoría</th>
                <th className="p-3 font-medium">Nombre</th>
                <th className="p-3 font-medium">Presentación</th>
                <th className="p-3 font-medium">Precio ref.</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const thumbUrl = thumbnailPublicUrl(row.catalog_product_media)
                return (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="p-3 align-middle">
                    {thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbUrl}
                        alt=""
                        className="h-10 w-10 rounded-md border border-border object-cover bg-muted"
                      />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
                        —
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {sectionById.get(row.section_id)?.name ?? '—'}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {categoryById.get(row.category_id)?.name ?? '—'}
                  </td>
                  <td className="p-3 font-medium">{row.name}</td>
                  <td className="p-3 text-muted-foreground">
                    {[row.brand, row.format, row.unit].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="p-3">
                    {row.default_reference_price != null
                      ? `$${Number(row.default_reference_price).toFixed(0)}`
                      : '—'}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
