# Área autenticada `(app)`

Rutas bajo `src/app/(app)/`. Cada carpeta con `page.tsx` es una pantalla.

| Ruta | Rol en el producto |
|------|-------------------|
| `/dashboard` | Resumen |
| `/inventory` | Inventario del hogar (`products` + stock) |
| `/catalog` | Catálogo maestro (`catalog_products`) + copia al perfil |
| `/capture` | Alta asistida por foto → `products` |
| `/receipts` | Boletas / tickets → `purchase_receipts` |
| `/stock-checks` | Inventario físico por zona |
| `/history` | Movimientos de stock (`stock_movements`) |
| `/consumption` | Registro de consumo |
| `/shopping-list` | Lista de compras |
| `/supermarket` | Vista supermercado |
| `/users` | Equipo e invitaciones |
| `/settings` | Ajustes del perfil |
| `/menu` | Índice de módulos |
| `/style-lab` | Demo de estilos (dev) |

Textos de ayuda unificados: `src/lib/domain.ts`. Modelo de negocio: `docs/DOMAIN.md`.
