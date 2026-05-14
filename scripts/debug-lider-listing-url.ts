/**
 * Depuración local: captura una URL de listado Lider y muestra conteos (sin Supabase).
 * Uso: npx tsx --tsconfig tsconfig.json scripts/debug-lider-listing-url.ts
 */
import { captureLiderRetailPage, partitionLiderCaptureForCleanInsert } from '@/server/retail/capture/lider-capture'

const URL =
  process.argv[2]?.trim() ||
  'https://super.lider.cl/browse/aguas-bebidas-y-licores/soy-pyme/jugos-y-aguas/52660800_37604048_64849803'

async function main() {
  const cap = await captureLiderRetailPage(URL)
  if (!cap.ok) {
    console.log('CAPTURE_FAIL', cap.error)
    return
  }
  const part = partitionLiderCaptureForCleanInsert({
    snapshots: cap.data.snapshots,
    stagingRows: cap.data.stagingRows,
    rawProductCount: cap.data.rawProductCount,
  })
  console.log(
    JSON.stringify(
      {
        url: URL,
        rawProductCount: cap.data.rawProductCount,
        snapshotsLen: cap.data.snapshots.length,
        stagingLen: cap.data.stagingRows.length,
        productsFoundPartition: part.productsFound,
        cleanStagingLen: part.cleanStaging.length,
        discardedProducts: part.discardedProducts,
        sampleCleanRefs: part.cleanStaging.slice(0, 5).map((r) => ({
          external_ref: r.external_ref,
          title: r.title?.slice(0, 60),
          price: r.price,
        })),
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
