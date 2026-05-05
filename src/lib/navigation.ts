import type { LucideIcon } from 'lucide-react'
import {
  BarChart,
  BookMarked,
  Camera,
  FileText,
  History,
  Home,
  Menu,
  MinusCircle,
  Package,
  Palette,
  Settings,
  ShoppingCart,
  Store,
  Users,
} from 'lucide-react'

export type NavItem = {
  name: string
  href: string
  icon: LucideIcon
  /** Si es true, aparece en la barra inferior móvil (máx. 5 recomendado) */
  mobilePrimary: boolean
}

/**
 * Orden: inicio → operación diaria → compras → maestro → flujos IA → equipo → shell.
 * `mobilePrimary`: barra inferior (máx. ~5 ítems útiles). Ver docs/DOMAIN.md.
 */
export const navigationItems: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: Home, mobilePrimary: true },
  { name: 'Inventario', href: '/inventory', icon: Package, mobilePrimary: true },
  { name: 'Consumo', href: '/consumption', icon: MinusCircle, mobilePrimary: false },
  { name: 'Historial stock', href: '/history', icon: History, mobilePrimary: false },
  { name: 'Lista', href: '/shopping-list', icon: ShoppingCart, mobilePrimary: true },
  { name: 'Supermercado', href: '/supermarket', icon: Store, mobilePrimary: true },
  { name: 'Catálogo', href: '/catalog', icon: BookMarked, mobilePrimary: false },
  { name: 'Captura IA', href: '/capture', icon: Camera, mobilePrimary: false },
  { name: 'Boletas', href: '/receipts', icon: FileText, mobilePrimary: false },
  { name: 'Chequeo stock', href: '/stock-checks', icon: BarChart, mobilePrimary: false },
  { name: 'Equipo', href: '/users', icon: Users, mobilePrimary: false },
  { name: 'Menú', href: '/menu', icon: Menu, mobilePrimary: true },
  { name: 'Estilos (demo)', href: '/style-lab', icon: Palette, mobilePrimary: false },
  { name: 'Configuración', href: '/settings', icon: Settings, mobilePrimary: false },
]

export const desktopNavItems = navigationItems.filter((i) => i.href !== '/menu')
export const mobileBottomNavItems = navigationItems.filter((i) => i.mobilePrimary)
