/** Pieles de interfaz disponibles (modo claro de referencia; oscuro mantiene la identidad). */
export const UI_STYLE_IDS = [
  'nordic-air',
  'pastel-dream',
  'bubble-play',
  'kinetic-pop',
  'neo-playful',
  'apple-liquid',
  'arena-flash',
] as const

export type UiStyleId = (typeof UI_STYLE_IDS)[number]

export const UI_STYLE_STORAGE_KEY = 'stockcasa-ui-style'

export const UI_STYLE_META: Record<
  UiStyleId,
  { label: string; tagline: string; mood: string }
> = {
  'nordic-air': {
    label: 'Aire nórdico',
    tagline: 'Tipografía clara, mucho aire, rejillas amplias',
    mood: 'Orden escandinavo',
  },
  'pastel-dream': {
    label: 'Pastel dream',
    tagline: 'Curvas suaves, texto redondeado, bloques separados',
    mood: 'Suave, familiar',
  },
  'bubble-play': {
    label: 'Bubble play',
    tagline: 'Pills, relleno generoso, modales tipo chicle',
    mood: 'Juvenil, divertido',
  },
  'kinetic-pop': {
    label: 'Kinetic pop',
    tagline: 'Display apretada, rejilla densa, modal geométrico',
    mood: 'Energía, impacto',
  },
  'neo-playful': {
    label: 'Neo playful',
    tagline: 'Titulares expresivos, contraste y rejilla equilibrada',
    mood: 'Creativo, moderno',
  },
  'apple-liquid': {
    label: 'Apple liquid',
    tagline: 'Grises cálidos, Inter, acento azul, paneles vidrio',
    mood: 'macOS, sobrio, premium',
  },
  'arena-flash': {
    label: 'Arena flash',
    tagline: 'Oswald + Barlow, verde odds, sombras duras, rejilla apretada',
    mood: 'Apuestas / deportes, impacto',
  },
}

export const DEFAULT_UI_STYLE: UiStyleId = 'nordic-air'

export function isUiStyleId(value: string | null | undefined): value is UiStyleId {
  return value != null && (UI_STYLE_IDS as readonly string[]).includes(value)
}

/** Aplica la piel guardada en `<html data-ui-style>`. Solo ejecutar en el cliente. */
export function applyUiStyleFromStorage(): void {
  const raw =
    typeof localStorage !== 'undefined' ? localStorage.getItem(UI_STYLE_STORAGE_KEY) : null
  const id = isUiStyleId(raw) ? raw : DEFAULT_UI_STYLE
  document.documentElement.dataset.uiStyle = id
}
