'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  analyzeCatalogResetAction,
  executeCatalogResetAction,
} from '@/app/actions/catalog-reset'
import { toast } from 'sonner'

export default function CatalogResetPanel() {
  const [analysis, setAnalysis] = useState<Awaited<ReturnType<typeof analyzeCatalogResetAction>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)

  async function runAnalyze() {
    setLoading(true)
    const res = await analyzeCatalogResetAction()
    setLoading(false)
    if (res.ok) {
      setAnalysis(res)
    } else {
      toast.error(res.error)
    }
  }

  async function runExecute() {
    if (!analysis?.ok) return
    const confirmed = window.confirm(
      `Vas a borrar ${analysis.productosSegurosBorrar} productos del catálogo, ` +
      `${analysis.marcasSegurasBorrar} marcas, ${analysis.categoriasSoloScrapping} categorías y ` +
      `${analysis.seccionesSoloScrapping} secciones.\n\n` +
      `Se restaurarán ${analysis.scrappingMatched} filas de scrapping a pending_new.\n\n` +
      `¿Confirmas?`
    )
    if (!confirmed) return

    setExecuting(true)
    const res = await executeCatalogResetAction()
    setExecuting(false)
    if (res.ok) {
      toast.success(
        `Reset completado:\n` +
        `${res.deletedProducts} productos borrados\n` +
        `${res.deletedMedia} imágenes borradas\n` +
        `${res.deletedRetailLinks} links retail borrados\n` +
        `${res.deletedRetailSnapshots} snapshots borrados\n` +
        `${res.deletedBrands} marcas borradas\n` +
        `${res.deletedCategories} categorías borradas\n` +
        `${res.deletedSections} secciones borradas\n` +
        `${res.restoredPendingNew} scrapping restaurados a pending_new`
      )
      setAnalysis(null)
    } else {
      toast.error(res.error)
    }
  }

  return (
    <section className="app-panel">
      <h2 className="text-sm font-semibold">Mantenimiento del Catálogo</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Herramienta de emergencia: borra productos creados automáticamente por scrapping
        (sin stock ni movimientos), restaura scrapping a pending_new y permite reprocesar
        con imagen correcta.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={runAnalyze} disabled={loading} variant="outline">
          {loading ? 'Analizando…' : 'Analizar catálogo'}
        </Button>
        {analysis?.ok && analysis.productosSegurosBorrar > 0 && (
          <Button onClick={runExecute} disabled={executing} variant="destructive">
            {executing ? 'Ejecutando…' : `Resetear ${analysis.productosSegurosBorrar} productos`}
          </Button>
        )}
      </div>

      {analysis?.ok && (
        <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Productos scrapping</div>
            <div className="font-semibold">{analysis.productosScrapping}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Seguros de borrar</div>
            <div className="font-semibold text-destructive">{analysis.productosSegurosBorrar}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Con stock (preservados)</div>
            <div className="font-semibold text-amber-600">{analysis.productosConStock}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Con movimientos (preservados)</div>
            <div className="font-semibold text-amber-600">{analysis.productosConMovimientos}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Marcas seguras de borrar</div>
            <div className="font-semibold">{analysis.marcasSegurasBorrar}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Secciones solo scrapping</div>
            <div className="font-semibold">{analysis.seccionesSoloScrapping}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Categorías solo scrapping</div>
            <div className="font-semibold">{analysis.categoriasSoloScrapping}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">scrapping matched</div>
            <div className="font-semibold">{analysis.scrappingMatched}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">scrapping pending_new</div>
            <div className="font-semibold">{analysis.scrappingPendingNew}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Imágenes en media</div>
            <div className="font-semibold">{analysis.mediaFiles}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Retail snapshots</div>
            <div className="font-semibold">{analysis.retailSnapshots}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Retail links</div>
            <div className="font-semibold">{analysis.retailLinks}</div>
          </div>
        </div>
      )}

      {analysis?.ok && analysis.productosSegurosBorrar === 0 && (
        <p className="mt-3 text-[13px] text-green-600">
          No hay productos seguros de borrar. Todo el catálogo tiene stock o movimientos.
        </p>
      )}
    </section>
  )
}
