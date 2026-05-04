import Link from 'next/link'
import { navigationItems } from '@/lib/navigation'
import { appGlassCardClass } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
              className={cn(
                appGlassCardClass,
                'flex items-center gap-3 px-4 py-3 text-sm font-medium transition hover:border-white/15'
              )}
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
