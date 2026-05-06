import Link from 'next/link'
import { navigationTree, type NavNode } from '@/lib/navigation'
import { appGlassCardClass } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function MenuSection({ node }: { node: NavNode }) {
  if (node.type === 'link') {
    return (
      <li className="sm:col-span-2">
        <Link
          href={node.href}
          className={cn(
            appGlassCardClass,
            'flex items-center gap-3 px-4 py-3 text-sm font-medium transition hover:border-white/15'
          )}
        >
          <node.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          {node.name}
        </Link>
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-2 sm:col-span-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {node.name}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {node.children.map((child) => (
          <li key={`${node.name}-${child.name}-${child.href}`}>
            <Link
              href={child.href}
              className={cn(
                appGlassCardClass,
                'flex items-center gap-3 px-4 py-3 text-sm font-medium transition hover:border-white/15'
              )}
            >
              <child.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              {child.name}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  )
}

export default function MenuPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Menú</h1>
        <p className="text-sm text-muted-foreground">
          Misma jerarquía que la barra lateral. Los textos de cada pantalla siguen el rol funcional del
          módulo (Catálogo ≠ Inventario; Consumo descuenta; Compras planifica; etc.). Laboratorio solo en
          desarrollo.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {navigationTree.map((node) => (
          <MenuSection key={node.type === 'link' ? node.href : node.name} node={node} />
        ))}
      </ul>
    </div>
  )
}
