import type { LucideIcon } from 'lucide-react'
import {
  BarChart,
  BookMarked,
  Building2,
  Camera,
  ClipboardList,
  FileText,
  History,
  Home,
  Mail,
  Menu,
  MinusCircle,
  Package,
  PenLine,
  Receipt,
  Settings,
  ShoppingCart,
  Store,
  Tag,
  UserRound,
  Users,
  Layers,
  List,
} from 'lucide-react'

/** Enlace hoja (sidebar o subítem). */
export type NavChild = {
  name: string
  href: string
  icon: LucideIcon
}

/** Nodo de navegación: enlace simple o grupo con hijos. */
export type NavNode =
  | {
      type: 'link'
      name: string
      href: string
      icon: LucideIcon
    }
  | {
      type: 'group'
      name: string
      icon: LucideIcon
      children: NavChild[]
    }

/**
 * Jerarquía según PROJECT_CONTEXT.md.
 * Catálogo: misma ruta con `?tab=` para estado activo en sidebar y pestañas.
 */
export const navigationTree: NavNode[] = [
  { type: 'link', name: 'Dashboard', href: '/dashboard', icon: Home },
  {
    type: 'group',
    name: 'Catálogo',
    icon: BookMarked,
    children: [
      { name: 'Productos', href: '/catalog?tab=productos', icon: Package },
      { name: 'Marcas', href: '/catalog?tab=marcas', icon: Tag },
      { name: 'Categorías', href: '/catalog?tab=categorias', icon: Layers },
    ],
  },
  {
    type: 'group',
    name: 'Inventario',
    icon: Package,
    children: [
      { name: 'Ver inventario', href: '/inventory', icon: List },
      { name: 'Cargar por fotos', href: '/capture', icon: Camera },
      { name: 'Cargar por boleta', href: '/receipts', icon: Receipt },
      { name: 'Carga manual', href: '/inventory#carga-manual', icon: PenLine },
    ],
  },
  {
    type: 'group',
    name: 'Consumo',
    icon: MinusCircle,
    children: [
      { name: 'Registrar consumo', href: '/consumption', icon: MinusCircle },
      { name: 'Historial de stock', href: '/history', icon: History },
    ],
  },
  {
    type: 'group',
    name: 'Chequeo de stock',
    icon: BarChart,
    children: [
      { name: 'Nuevo chequeo', href: '/stock-checks#stock-check-nuevo', icon: ClipboardList },
      {
        name: 'Historial de chequeos',
        href: '/stock-checks#stock-check-historial',
        icon: History,
      },
    ],
  },
  {
    type: 'group',
    name: 'Compras',
    icon: ShoppingCart,
    children: [
      { name: 'Listas de compra', href: '/shopping-list', icon: ShoppingCart },
      { name: 'Tiendas', href: '/supermarket', icon: Store },
      { name: 'Historial de compras', href: '/receipts', icon: FileText },
    ],
  },
  {
    type: 'group',
    name: 'Administración',
    icon: Users,
    children: [
      { name: 'Ubicación', href: '/profiles/new', icon: Building2 },
      { name: 'Personas', href: '/users#admin-personas', icon: UserRound },
      { name: 'Invitaciones enviadas', href: '/users#admin-invitaciones', icon: Mail },
    ],
  },
  { type: 'link', name: 'Configuración', href: '/settings', icon: Settings },
]

/** Barra inferior móvil: prioridad PROJECT_CONTEXT (sin Estilos demo ni ítem suelto «Equipo»). */
export const mobileBottomNavItems: {
  name: string
  href: string
  icon: LucideIcon
}[] = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Inventario', href: '/inventory', icon: Package },
  { name: 'Consumo', href: '/consumption', icon: MinusCircle },
  { name: 'Compras', href: '/shopping-list', icon: ShoppingCart },
  { name: 'Menú', href: '/menu', icon: Menu },
]

/** Descompone `href` de navegación (path relativo, query sin `?`, hash con `#`). */
function splitNavHref(href: string): { path: string; search: string; hash: string } {
  let rest = href
  let hash = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    hash = rest.slice(hashIdx)
    rest = rest.slice(0, hashIdx)
  }
  let path = rest
  let search = ''
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) {
    path = rest.slice(0, qIdx)
    search = rest.slice(qIdx + 1)
  }
  return { path, search, hash }
}

/**
 * Estado activo: pathname, opcionalmente hash (`#fragmento`) o query esperada (`?param=…`).
 * `currentSearch` es el `search` de la URL actual sin `?` (p. ej. `tab=marcas`).
 * En `/catalog` sin `tab`, se considera activo el subenlace `?tab=productos`.
 */
export function navLinkIsActive(
  pathname: string,
  locationHash: string,
  href: string,
  currentSearch = ''
): boolean {
  const { path, search: hrefSearch, hash } = splitNavHref(href)

  if (hash) {
    return pathname === path && locationHash === hash
  }

  if (hrefSearch) {
    if (pathname !== path) return false
    const expected = new URLSearchParams(hrefSearch)
    const current = new URLSearchParams(
      currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch
    )
    for (const [key, value] of expected.entries()) {
      if (key === 'tab' && value === 'productos' && path === '/catalog') {
        const t = current.get('tab')
        if (t === null || t === '' || t === 'productos') continue
        return false
      }
      if (current.get(key) !== value) return false
    }
    return true
  }

  return pathname === path
}
