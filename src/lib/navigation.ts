import { Home, Package, ShoppingCart, Store, FileText, BarChart, LucideIcon } from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

export const navItems: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Inventario', href: '/inventory', icon: Package },
  { name: 'Lista', href: '/shopping-list', icon: ShoppingCart },
  { name: 'Supermercado', href: '/supermarket', icon: Store },
  { name: 'Boletas', href: '/receipts', icon: FileText },
  { name: 'Stock', href: '/stock-checks', icon: BarChart },
];