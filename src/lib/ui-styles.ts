/** Identificadores de pieles de interfaz (modo claro de referencia; modo oscuro mantiene la misma identidad). */
export const UI_STYLE_IDS = [
  'soft-minimal',
  'nordic-air',
  'editorial-luxe',
  'kinetic-pop',
  'bento-contrast',
  'bubble-play',
  'farmhouse-warm',
  'pastel-dream',
  'neo-playful',
  'magazine-serif',
  'mono-lab',
  'kitchen-round',
] as const

export type UiStyleId = (typeof UI_STYLE_IDS)[number]

export const UI_STYLE_STORAGE_KEY = 'stockcasa-ui-style'

export const UI_STYLE_META: Record<
  UiStyleId,
  { label: string; tagline: string; mood: string }
> = {
  'soft-minimal': {
    label: 'Soft minimal',
    tagline: 'Espacio en blanco y grises suaves',
    mood: 'Calma, productividad',
  },
  'nordic-air': {
    label: 'Aire nórdico',
    tagline: 'Frío, limpio, mucho aire',
    mood: 'Orden escandinavo',
  },
  'editorial-luxe': {
    label: 'Editorial',
    tagline: 'Serif dramática y contraste fino',
    mood: 'Revista, elegancia',
  },
  'kinetic-pop': {
    label: 'Kinetic pop',
    tagline: 'Tipografía display y acento neón',
    mood: 'Energía, impacto',
  },
  'bento-contrast': {
    label: 'Bento grid',
    tagline: 'Bloques sólidos estilo dashboard 2025',
    mood: 'Producto tech friendly',
  },
  'bubble-play': {
    label: 'Bubble play',
    tagline: 'Pill buttons, curvas extremas, candy',
    mood: 'Juvenil, divertido',
  },
  'farmhouse-warm': {
    label: 'Granero cálido',
    tagline: 'Crema, terracota, serif orgánica',
    mood: 'Hogar acogedor',
  },
  'pastel-dream': {
    label: 'Pastel dream',
    tagline: 'Gradientes suaves y redondez',
    mood: 'Suave, familiar',
  },
  'neo-playful': {
    label: 'Neo playful',
    tagline: 'Grotesque expresiva y color block',
    mood: 'Creativo, moderno',
  },
  'magazine-serif': {
    label: 'Magazine',
    tagline: 'Sans + serif display de contraste',
    mood: 'Look editorial mixto',
  },
  'mono-lab': {
    label: 'Mono lab',
    tagline: 'Todo monoespaciado, estética dev',
    mood: 'Datos, precisión',
  },
  'kitchen-round': {
    label: 'Cocina redonda',
    tagline: 'Formas muy redondeadas y tonos comida',
    mood: 'App familiar, amable',
  },
}

export const DEFAULT_UI_STYLE: UiStyleId = 'soft-minimal'

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
