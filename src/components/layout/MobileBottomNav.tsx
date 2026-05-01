import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItems } from '@/lib/navigation';

const MobileBottomNav: React.FC = () => {
  const pathname = usePathname();

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 bg-background border-t md:hidden">
      <nav className="flex items-center justify-around p-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-1 p-2 ${pathname === item.href ? 'text-primary' : 'text-muted-foreground'}`}
          >
            <item.icon className="h-5 w-5" />
            <span className="text-xs">{item.name}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
};

export default MobileBottomNav;
