import { visionCostHint } from '@/lib/vision-cost-hint'
import type { StockCheckAiMeta } from '@/types/stock-check-ai-meta'

function pct01(n: number) {
  return `${Math.round(n * 100)}%`
}

/** Resumen de IA para tabla (compacto) o panel de revisión. */
export function StockCheckAiPanel({
  meta,
  variant = 'block',
}: {
  meta: StockCheckAiMeta | null
  variant?: 'table' | 'block'
}) {
  if (!meta) {
    if (variant === 'table') {
      return (
        <span className="text-[11px] text-muted-foreground" title="Sin metadatos guardados">
          —
        </span>
      )
    }
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
        No hay proveedor ni modelo registrados para este chequeo (registro
        anterior a esta función o guardado sin metadatos de IA).
      </p>
    )
  }

  const { vision, confidenceAvg, confidenceMin, confidenceCoverage } = meta
  const cost = visionCostHint(vision.provider)
  const hasConf =
    confidenceAvg != null &&
    confidenceCoverage != null &&
    confidenceCoverage > 0

  if (variant === 'table') {
    return (
      <div className="max-w-[220px] text-[11px] leading-snug text-muted-foreground">
        <div className="font-medium text-foreground">{vision.providerLabel}</div>
        <div className="font-mono text-[10px] opacity-90">{vision.model}</div>
        <div className="mt-0.5 text-[10px]">{cost}</div>
        {hasConf ? (
          <div className="tabular-nums text-foreground/90">
            Conf. media ~{pct01(confidenceAvg!)}
            {confidenceMin != null ? ` · mín. ${pct01(confidenceMin)}` : ''}
          </div>
        ) : (
          <div className="text-[10px] italic">Sin puntuación del modelo</div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[13px] space-y-2">
      <div>
        <span className="font-semibold text-foreground">Análisis de imagen</span>
        <p className="mt-1 text-muted-foreground">
          {vision.providerLabel} · modelo{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
            {vision.model}
          </code>
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">{cost}</p>
      </div>
      <div className="border-t border-border pt-2 text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground">Precisión estimada</span>
        <p className="mt-1">
          {hasConf ? (
            <>
              Confianza media del modelo (por ítem):{' '}
              <span className="tabular-nums font-medium text-foreground">
                ~{pct01(confidenceAvg!)}
              </span>
              {confidenceMin != null ? (
                <>
                  {' '}
                  · mínima entre ítems:{' '}
                  <span className="tabular-nums font-medium text-foreground">
                    {pct01(confidenceMin)}
                  </span>
                </>
              ) : null}
              {confidenceCoverage != null && confidenceCoverage < 1 ? (
                <span className="block mt-1 italic">
                  Solo {pct01(confidenceCoverage)} de los ítems incluían
                  puntuación; el resto debe revisarse manualmente.
                </span>
              ) : null}
            </>
          ) : (
            <>
              El modelo no devolvió valores de confianza por ítem. La exactitud
              depende de la foto y del proveedor; revisa cada línea manualmente.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
