import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Package, ShoppingCart, Store, FileText, BarChart } from 'lucide-react';

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Inventario', href: '/inventory', icon: Package },
  { name: 'Lista', href: '/shopping-list', icon: ShoppingCart },
  { name: 'Supermercado', href: '/supermarket', icon: Store },
  { name: 'Boletas', href: '/receipts', icon: FileText },
  { name: 'Stock', href: '/stock-checks', icon: BarChart },
];

const DesktopSidebar: React.FC = () => {
  const pathname = usePathname();

  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 items-center border-b px-4 lg:h-15 lg:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="">HubStock AI</span>
          </Link>
        </div>
        <div className="flex-1">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary ${pathname === item.href ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
};

export default DesktopSidebar;