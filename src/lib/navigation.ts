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
 * Rutas solo existentes; Marcas/Categorías del catálogo apuntan a `/catalog` (misma vista).
 */
export const navigationTree: NavNode[] = [
  { type: 'link', name: 'Dashboard', href: '/dashboard', icon: Home },
  {
    type: 'group',
    name: 'Catálogo',
    icon: BookMarked,
    children: [
      { name: 'Productos', href: '/catalog', icon: Package },
      { name: 'Marcas', href: '/catalog', icon: Tag },
      { name: 'Categorías', href: '/catalog', icon: Layers },
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
      { name: 'Perfiles', href: '/profiles/new', icon: Building2 },
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

/** Estado activo para cualquier `href` (incluye fragmento). */
export function navLinkIsActive(
  pathname: string,
  locationHash: string,
  href: string
): boolean {
  if (href.includes('#')) {
    const [path, frag] = href.split('#')
    return pathname === path && locationHash === `#${frag}`
  }
  return pathname === href
}
