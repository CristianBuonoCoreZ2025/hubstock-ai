import type { VisionAnalysisMeta } from '@/types/vision-meta'

export function VisionAnalysisNote({
  vision,
}: {
  vision: VisionAnalysisMeta | null
}) {
  if (!vision) return null
  const kind = vision.analysisKind ?? 'image'
  const kindLabel =
    kind === 'document_text'
      ? 'Análisis de documento (texto)'
      : 'Análisis de imagen'
  return (
    <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
      <span className="font-medium text-foreground">{kindLabel}:</span>{' '}
      {vision.providerLabel} · modelo{' '}
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
        {vision.model}
      </code>
    </p>
  )
}
