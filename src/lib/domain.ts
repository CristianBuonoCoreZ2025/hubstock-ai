/**
 * Definiciones de producto y textos de ayuda alineados con docs/DOMAIN.md.
 * Mantener aquí los párrafos de “lead” evita que cada pantalla diga una cosa distinta.
 */

export const PAGE_LEADS = {
  /** Inventario: productos con stock del hogar (misma taxonomía global). */
  inventory:
    'Productos de este hogar con stock y precios. La sección y la categoría son la misma taxonomía global que en Catálogo y Captura; aquí ajustas cantidades y la ficha del ítem.',

  /** Catálogo maestro: solo lectura + copia al perfil. */
  catalogMaster:
    'Lista base compartida entre hogares (sin stock). Úsala para copiar ítems ya clasificados a tu inventario; luego el stock y precios reales se editan en Inventario.',

  /** Captura: un producto por flujo, foto + IA → products. */
  capture:
    'Un producto por sesión: foto → análisis con IA → confirmación de sección y categoría → alta en el inventario de este hogar.',

  /** Boletas: documento con muchas líneas. */
  receipts:
    'Ticket de compra: varias líneas por boleta, análisis asistido y revisión antes de impactar inventario al confirmar.',

  /** Chequeo: inventario físico por zona. */
  stockChecks:
    'Fotos por zona con detección asistida; las líneas quedan pendientes hasta que confirmes cantidades y vínculos con productos.',

  /** Historial: solo movimientos de stock; no mezclar con boletas. */
  history:
    'Movimientos de stock del hogar (entradas y salidas). Las boletas y capturas pueden generar movimientos; aquí ves el registro contable por producto.',
} as const

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  consumption: 'Consumo',
  purchase: 'Compra / ingreso',
  adjustment: 'Ajuste',
  import: 'Importación',
  inventory_count: 'Conteo de inventario',
}

/** Etiqueta en español para `stock_movements.movement_type`. */
export function movementTypeLabel(type: string | null | undefined): string {
  if (type == null || type === '') return '—'
  return MOVEMENT_TYPE_LABELS[type] ?? type
}
