import Link from 'next/link'
import { navigationItems } from '@/lib/navigation'

export default function MenuPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Menú</h1>
        <p className="text-sm text-muted-foreground">
          Accesos rápidos a todos los módulos (mobile first).
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {navigationItems.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
            >
              <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
