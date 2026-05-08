import { foldPrivateLabelBrand } from '@/lib/retail-private-label'

export type RetailSnapshotRow = {
  retailer: string
  external_ref: string
  source_url: string | null
  title: string
  price: number
  category_hint: string | null
  brand_hint: string | null
  description_hint: string | null
  match_method: string
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '')
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function pickPrice(product: Record<string, unknown>): number | null {
  const items = product.items
  if (!Array.isArray(items) || items.length === 0) return null
  const firstItem = asRecord(items[0])
  if (!firstItem) return null
  const sellers = firstItem.sellers
  if (!Array.isArray(sellers) || sellers.length === 0) return null
  for (const s of sellers) {
    const seller = asRecord(s)
    if (!seller) continue
    const offer = asRecord(seller.commertialOffer)
    if (!offer) continue
    const price = offer.Price ?? offer.price
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) return price
  }
  return null
}

function buildProductUrl(baseUrl: string, product: Record<string, unknown>): string | null {
  const linkText =
    typeof product.linkText === 'string' && product.linkText.trim() ?
      product.linkText.trim()
    : null
  if (linkText) {
    return `${trimBase(baseUrl)}/${linkText}/p`
  }
  return null
}

function categoryHintFromProduct(product: Record<string, unknown>): string | null {
  const cats = product.categories
  if (!Array.isArray(cats) || cats.length === 0) return null
  const last = cats[cats.length - 1]
  if (typeof last === 'string') {
    const parts = last.split('/').filter(Boolean)
    return parts[parts.length - 1]?.replace(/-/g, ' ') ?? null
  }
  return null
}

/**
 * Convierte un producto VTEX catalog_system/search en fila para catalog_retail_snapshots.
 */
export function mapVtexProductToSnapshot(
  productRaw: unknown,
  ctx: {
    retailer: string
    vtexBaseUrl: string
    matchMethod: string
  },
): RetailSnapshotRow | null {
  const product = asRecord(productRaw)
  if (!product) return null

  const title =
    typeof product.productName === 'string' && product.productName.trim() ?
      product.productName.trim()
    : null
  if (!title) return null

  const price = pickPrice(product)
  if (price == null || price <= 0) return null

  const url = buildProductUrl(ctx.vtexBaseUrl, product)
  const productId =
    product.productId != null ? String(product.productId)
    : product.productID != null ? String(product.productID)
    : null

  const external_ref =
    url ?? (productId ? `vtex:productId:${productId}` : `vtex:hash:${hashStable(productRaw)}`)

  const rawBrand =
    typeof product.brand === 'string' && product.brand.trim() ? product.brand.trim() : null
  const categoryHint = categoryHintFromProduct(product)

  const items = product.items
  let descriptionHint: string | null = null
  if (Array.isArray(items) && items.length > 0) {
    const it = asRecord(items[0])
    const iname = it && typeof it.name === 'string' ? it.name.trim() : ''
    if (iname && iname !== title) descriptionHint = iname
  }

  const folded = foldPrivateLabelBrand(rawBrand, title, categoryHint)

  return {
    retailer: ctx.retailer,
    external_ref,
    source_url: url,
    title,
    price,
    category_hint: categoryHint,
    brand_hint: folded.brand,
    description_hint: descriptionHint,
    match_method: ctx.matchMethod,
  }
}

function hashStable(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
    }
    return Math.abs(h).toString(36)
  } catch {
    return String(Date.now())
  }
}

export function mapVtexProductList(
  products: unknown[],
  ctx: { retailer: string; vtexBaseUrl: string; matchMethod: string },
): RetailSnapshotRow[] {
  const out: RetailSnapshotRow[] = []
  for (const p of products) {
    const row = mapVtexProductToSnapshot(p, ctx)
    if (row) out.push(row)
  }
  return out
}
