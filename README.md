# Hub Stock AI (StockCasa)

Aplicación **Next.js** para inventario del hogar por **perfil**, con flujos asistidos por IA (captura de producto, boletas, chequeo de stock) y backend **Supabase** (Postgres + Auth + Storage).

## Documentación de dominio

- **`docs/DOMAIN.md`** — Qué es sección, categoría, producto maestro vs producto del hogar, y cómo se relacionan **Inventario**, **Catálogo**, **Captura**, **Boletas**, **Historial de stock** y **Chequeo**.
- **`src/lib/domain.ts`** — Párrafos de ayuda (`PAGE_LEADS`) y etiquetas de historial (`movementTypeLabel`) para no duplicar criterios entre pantallas.

## Estructura útil

| Ruta en repo | Contenido |
|--------------|-----------|
| `src/app/(app)/` | Páginas autenticadas (ver `src/app/(app)/README.md`) |
| `src/app/actions/` | Server Actions (lectura/escritura Supabase) |
| `src/lib/` | Utilidades, navegación, dominio, Supabase cliente |
| `supabase/migrations/` | Esquema incremental (fuente de verdad DB) |

## Desarrollo

```bash
npm install
npm run dev
```

Variables de entorno: copiar `.env.example` si existe, o configurar `NEXT_PUBLIC_SUPABASE_*` y claves según tu proyecto Supabase.

### Migraciones

```bash
npm run db:push
```

En redes con DNS problemático el script ya incluye `--dns-resolver https` (ver `package.json`).

## Nota

Plantilla genérica de Create Next App debajo de esta sección fue reemplazada por documentación del proyecto; para tutoriales oficiales de Next.js ver [nextjs.org/docs](https://nextjs.org/docs).
