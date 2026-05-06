/**
 * Definiciones de producto y textos de ayuda alineados con docs/DOMAIN.md.
 * Mantener aquí los párrafos de “lead” evita que cada pantalla diga una cosa distinta.
 */

export const PAGE_LEADS = {
  /** Dashboard: vista ejecutiva del perfil activo. */
  dashboard:
    'Resumen del hogar seleccionado en el selector de perfil. Las métricas y accesos se referencian a ese perfil.',

  /** Inventario: stock del hogar; coherente con sub-rutas del menú (ver, fotos, boleta, manual). */
  inventory:
    'Stock de este hogar: cada ítem está ligado al catálogo global. Puedes elegir un maestro ya existente o, si no está creado, dar de alta el nombre estándar en catálogo y en este inventario en el mismo flujo (según permisos). Aquí ajustas sección/categoría comercial y cantidades. También: fotos, boleta o ajustes manuales.',

  /** Catálogo: global; no es inventario ni stock del hogar. */
  catalogMaster:
    'Productos, marcas y categorías en vista global (sin cantidades del hogar). Copia al perfil desde aquí; el stock operativo vive en Inventario.',

  /** Captura = Inventario · cargar por fotos. */
  capture:
    'Inventario · Cargar por fotos: mismo esquema que el chequeo de stock (modelos OpenRouter, zona física fija, foto). Por cada producto detectado se propone categoría del catálogo global (editable por fila) y la zona elegida se guarda como ubicación física del ítem.',

  /** Boletas: ingreso a inventario desde ticket; mismo listado enlazado desde Compras como historial. */
  receipts:
    'Boleta de compra: subir o guardar solo crea un borrador con ítems detectados; el stock del hogar no cambia hasta que confirmas tras revisar y emparejar líneas. Este listado también cumple el rol de historial de boletas del módulo Compras.',

  /** Chequeo de stock: comparar físico vs sistema y aplicar ajustes. */
  stockChecks:
    'Chequeo de stock por zona: detección asistida, revisión de líneas y propuesta de ajustes al confirmar (impacto en inventario).',

  /** Historial global de movimientos de stock (no solo consumos). Enlace desde Consumo en el menú. */
  history:
    'Registro de movimientos de stock del hogar en una sola vista: consumos, cargas de inventario (captura, boleta confirmada u otras compras que impactan stock), ajustes y conteos de chequeo. Sirve para auditar cómo cambió cada producto.',

  /** Consumo: solo registrar salidas. */
  consumption:
    'Descuenta unidades del inventario del perfil activo; cada confirmación registra un movimiento de consumo.',

  /** Configuración: preferencias y casa/sesión. */
  settings:
    'Preferencias y datos generales del hogar activo, más opciones de sesión.',

  /** Administración · Ubicación — alta de hogar. */
  profilesNew:
    'Alta de una ubicación adicional (hogar). Podrás alternarla desde el selector; las zonas físicas disponibles son las mismas en todas las ubicaciones.',

  /** Ruta técnica / dev; no es módulo funcional. */
  styleLabDev:
    'Herramienta técnica para probar apariencia en desarrollo; no forma parte del flujo operativo de inventario o compras.',
} as const

/**
 * Etiquetas UI para `stock_movements.movement_type` (valores fijos en BD).
 * Mapeo funcional aproximado: `import` — alta manual o captura con cantidad inicial;
 * `purchase` — boletas / compras confirmadas; `consumption` — consumo; `inventory_count` — chequeo;
 * `adjustment` — edición manual de cantidad en inventario u otros ajustes no cubiertos arriba.
 *
 * Consistencia (Etapa 3.2): en alta manual, captura y edición de cantidad, si falla el insert en
 * `stock_movements` tras actualizar `products`, las server actions compensan (stock inicial → 0 o
 * cantidad revertida al valor previo) para no dejar stock cambiado sin movimiento asociado.
 */
const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  consumption: 'Consumo',
  purchase: 'Compra / ingreso',
  adjustment: 'Ajuste manual',
  import: 'Alta / importación inicial',
  inventory_count: 'Conteo de inventario',
}

/** Etiqueta en español para `stock_movements.movement_type`. */
export function movementTypeLabel(type: string | null | undefined): string {
  if (type == null || type === '') return '—'
  return MOVEMENT_TYPE_LABELS[type] ?? type
}
