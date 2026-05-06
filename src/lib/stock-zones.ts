/**
 * Zonas físicas del hogar (misma lista en chequeo de stock y carga por fotos).
 * Toda ubicación (perfil) usa este mismo conjunto por defecto.
 */
export const STOCK_ZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'alacena', label: 'Alacena' },
  { value: 'refrigerador', label: 'Refrigerador' },
  { value: 'congelador', label: 'Congelador' },
  { value: 'bano', label: 'Baño / aseo' },
  { value: 'bodega', label: 'Bodega' },
  { value: 'otro', label: 'Otro' },
]

export function stockZoneLabel(zone: string): string {
  return STOCK_ZONE_OPTIONS.find((x) => x.value === zone)?.label ?? zone
}
