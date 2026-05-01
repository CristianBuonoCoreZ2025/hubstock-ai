export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Historial y reportes</h1>
      <p className="text-sm text-muted-foreground">
        Aquí se consolidarán viajes de compra, boletas y movimientos de stock por{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">profile_id</code>.
      </p>
    </div>
  )
}
