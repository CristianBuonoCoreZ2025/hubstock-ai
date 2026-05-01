export default function ConsumptionPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Consumo rápido</h1>
      <p className="text-sm text-muted-foreground">
        Registra salidas de stock con un toque (usa{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">stock_movements</code> con{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">movement_type = consumption</code>
        ). UI próxima iteración.
      </p>
    </div>
  )
}
