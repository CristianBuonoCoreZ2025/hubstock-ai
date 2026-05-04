# StockCasa AI — Estado del proyecto (contexto para agentes)

Este documento resume qué existe en el repositorio, cómo encajan las piezas y qué conviene mejorar. Sirve como referencia rápida para personas y para herramientas de código asistido (por ejemplo Roo Code).

## Propósito

Aplicación web (Next.js) para inventario doméstico, listas de compra, supermercado, boletas y flujos con IA, con datos separados por **perfil** (hogar) y autenticación con **Supabase Auth**.

## Stack

| Área | Tecnología |
|------|------------|
| Framework | Next.js **16.2.4** (Turbopack en build) |
| UI | React 19, Tailwind CSS 4, componentes varios (lucide-react, estilos tipo shadcn) |
| Auth y datos | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) |
| Validación | Zod |
| Tipos DB | `src/types/database` (tipos generados o mantenidos a mano) |

**Nota:** En `AGENTS.md` se indica que la versión de Next en este repo puede diferir de la documentación “clásica”; conviene contrastar con `node_modules/next/dist/docs/` cuando haya dudas de API.

## Variables de entorno

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (o clave publicable según el proyecto de Supabase)

Definir en `.env.local` (no commitear secretos). El build asume presencia de env en entorno de desarrollo.

## Estructura relevante

| Ruta | Rol |
|------|-----|
| `middleware.ts` (raíz) | Delega en `src/proxy` la lógica de cookies/sesión y redirecciones. |
| `src/proxy.ts` | Supabase `createServerClient` + reglas de rutas protegidas, login y raíz. |
| `src/lib/supabase/server.ts` | Cliente servidor (cookies con `next/headers`). |
| `src/lib/supabase/client.ts` | Cliente navegador; falla con error claro si faltan env. |
| `src/lib/profile/context.ts` | Perfiles del usuario vía `profile_members` + cookie `stockcasa_profile_id`. |
| `src/app/(auth)/` | Login, registro. |
| `src/app/(app)/` | Aplicación autenticada: dashboard, inventario, listas, etc. |
| `src/app/auth/callback/route.ts` | Intercambio OAuth/magic link → redirección. |
| `src/app/actions/profile.ts` | Server actions: crear perfil, fijar perfil activo (cookie). |
| `src/components/layout/AppShell.tsx` | Layout con sidebar, nav móvil, aviso de “crear perfil”. |

## Autenticación y middleware (comportamiento actual)

1. **Rutas protegidas** (prefijo): `/dashboard`, `/inventory`, `/shopping-list`, `/supermarket`, `/receipts`, `/stock-checks`, `/profiles` (incluye `/profiles/new` por el prefijo).
2. **Sin sesión** en ruta protegida → redirección a `/login?next=...` (ruta original en query).
3. **Con sesión** en `/login` o `/register` → redirección a `/dashboard` (no se usa una ruta `/profiles` inexistente).
4. **Raíz `/`** con sesión → `/dashboard`; sin sesión el `src/app/page.tsx` redirige a `/login`.

### Incidencia corregida (caída / bucle al ir al dashboard)

- **Bucle de redirecciones:** la condición de “ruta pública” usaba `pathname.startsWith('/')`, lo que es **verdadero para cualquier ruta**. Con sesión, el middleware trataba `/dashboard` como “público” y redirigía otra vez a `/dashboard` → bucle infinito (navegador: “demasiadas redirecciones” o fallo aparente al cargar).
- **Redirección inválida:** con sesión en login se enviaba a `/profiles`, pero **no existe** `page` en `/profiles` (solo `/profiles/new`), lo que producía 404 en algunos flujos.

En `src/proxy.ts` la raíz se detecta con igualdad estricta `pathname === '/'`, y la verificación de sesión en el borde usa `auth.getUser()` en lugar de confiar solo en `getSession()` para la decisión de acceso.

## Funcionalidad implementada (alto nivel)

- Login con email/contraseña y formulario en `LoginForm.tsx` (tras éxito: `router.refresh()` + `router.push` hacia `next` o `/dashboard`).
- Registro; callback de auth en `/auth/callback`.
- **Perfiles (hogares):** creación en `/profiles/new`, membresía en `profile_members`, cookie de perfil activo.
- **Dashboard:** conteo de productos del perfil activo (tabla `products`); tarjetas placeholder para más métricas.
- Navegación principal en `src/lib/navigation.ts`; shell responsive con `AppShell`.
- Rutas de app adicionales presentes en el árbol: inventario, lista de compras, supermercado, captura, boletas, chequeos de stock, historial, consumo, usuarios, menú, ajustes.
- APIs bajo `src/app/api/ai/*` (análisis de producto, boleta, stock check) según archivos en el repo.

## Mejoras recomendadas (deuda / siguiente paso)

1. **Middleware y Supabase:** alinear con la guía oficial más reciente (refresh de tokens, `setAll` y cabeceras anti-caché si aplica en tu versión de `@supabase/ssr`).
2. **Ruta `/profiles`:** crear página índice que redirija a `/profiles/new` o listado de hogares, o quitar el prefijo `/profiles` de la lista si no aplica.
3. **Dashboard:** completar métricas (bajo mínimo, supermercado, boletas) con vistas SQL o consultas acordes al esquema real.
4. **RLS y tablas:** revisar políticas en Supabase para `products`, `profiles`, `profile_members`; el dashboard ya muestra aviso si falla el conteo.
5. **Observabilidad:** usar `src/lib/logger.ts` / `error-handler.ts` de forma consistente en server actions y APIs.
6. **Pruebas:** añadir pruebas e2e o de contrato para login → dashboard y para rutas protegidas sin sesión.
7. **Limpieza:** carpeta `_legacy` solo como referencia; no mezclar importaciones desde ahí en código nuevo.

## Comandos

```bash
npm run dev      # desarrollo
npm run build    # compilación producción
npm run lint     # ESLint
```

## Convenciones para cambios de código

- Comentarios en código: **español neutro**; identificadores en **inglés**.
- No introducir rutas de redirección hacia páginas que no existan en el árbol `src/app`.
- Tras tocar middleware, probar: `/`, `/login`, `/dashboard` con y sin sesión.

---

*Última revisión de este documento: alineado con el estado del repo tras corrección del middleware y la página de inicio.*
