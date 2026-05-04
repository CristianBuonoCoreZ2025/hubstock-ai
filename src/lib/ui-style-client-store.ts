import {
  DEFAULT_UI_STYLE,
  UI_STYLE_STORAGE_KEY,
  applyUiStyleFromStorage,
  isUiStyleId,
  type UiStyleId,
} from '@/lib/ui-styles'

const CHANGE_EVENT = 'stockcasa-ui-style-change'

export function subscribeUiStyle(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  const run = () => onStoreChange()
  window.addEventListener(CHANGE_EVENT, run)
  window.addEventListener('storage', run)
  return () => {
    window.removeEventListener(CHANGE_EVENT, run)
    window.removeEventListener('storage', run)
  }
}

export function getUiStyleSnapshot(): UiStyleId {
  if (typeof window === 'undefined') return DEFAULT_UI_STYLE
  const raw = localStorage.getItem(UI_STYLE_STORAGE_KEY)
  return isUiStyleId(raw) ? raw : DEFAULT_UI_STYLE
}

export function getUiStyleServerSnapshot(): UiStyleId {
  return DEFAULT_UI_STYLE
}

/** Misma clave y `data-ui-style` que Style Lab y ThemeClientProvider. */
export function persistUiStyleChoice(id: UiStyleId) {
  localStorage.setItem(UI_STYLE_STORAGE_KEY, id)
  applyUiStyleFromStorage()
  window.dispatchEvent(new Event(CHANGE_EVENT))
}
