export default function CapturePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Captura de productos</h1>
      <p className="text-sm text-muted-foreground">
        Sube una foto; el backend llama{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">POST /api/ai/analyze-product</code>{' '}
        (Gemini) y, si hay código de barras legible, enriquecimiento con Open Food Facts. La
        creación en base de datos será solo tras confirmación del usuario.
      </p>
    </div>
  )
}
