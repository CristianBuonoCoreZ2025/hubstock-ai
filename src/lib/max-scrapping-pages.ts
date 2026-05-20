const STORAGE_KEY = 'stockcasa-max-scrapping-pages'
const DEFAULT_VALUE = 4000

export function getMaxScrappingPages(): number {
  if (typeof window === 'undefined') return DEFAULT_VALUE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_VALUE
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_VALUE
  } catch {
    return DEFAULT_VALUE
  }
}

export function setMaxScrappingPages(n: number) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, String(n))
  } catch {
    // ignore
  }
}
