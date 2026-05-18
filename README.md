# Hub Stock AI (StockCasa)

Aplicación **Next.js** para inventario del hogar por **perfil/ubicación**, con flujos asistidos por IA (captura de producto, boletas, chequeo de stock) y backend **Supabase** (Postgres + Auth + Storage).

## Stack Tecnológico

- **Framework:** Next.js (App Router)
- **Lenguaje:** TypeScript
- **Backend/DB:** Supabase (Postgres, Auth, Storage, Realtime)
- **Estilos:** Tailwind CSS + shadcn/ui
- **IA:** OpenRouter (modelos de visión para captura, boletas y chequeo de stock)
- **Iconografía:** Lucide React
- **Gestión de paquetes:** pnpm

---

## Instalación y Desarrollo

```bash
# Instalar dependencias
npm install

# Servidor de desarrollo
npm run dev

# Build de producción
npm run build

# Lint
npm run lint
```

### Migraciones de base de datos

```bash
npm run db:push
```

> En redes con DNS problemático el script ya incluye `--dns-resolver https` (ver `package.json`).

---

## Variables de Entorno

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OpenRouter (visión IA)
OPENROUTER_API_KEYS=key1,key2,key3
# o legacy:
OPENROUTER_API_KEY=

# URLs base VTEX para retailers
RETAIL_JUMBO_VTEX_BASE_URL=https://www.jumbo.cl
RETAIL_LIDER_VTEX_BASE_URL=https://super.lider.cl
RETAIL_CENTRAL_MAYORISTA_VTEX_BASE_URL=

# Opcional: RETAIL_LIDER_STORE_ORIGIN, RETAIL_LIDER_STOREFRONT_BROWSE_URLS
```

---

## Estructura del Proyecto

```
hub-stock-ai/
├── src/
│   ├── app/
│   │   ├── (app)/              # Rutas autenticadas (páginas principales)
│   │   ├── actions/            # Server Actions (lectura/escritura Supabase)
│   │   └── api/                # Route Handlers (APIs internas, IA, scrapping)
│   ├── components/             # Componentes React reutilizables
│   ├── lib/                    # Utilidades, navegación, dominio, validadores
│   ├── server/                 # Lógica de servidor (captura retail, IA, scrapping)
│   ├── types/                  # Tipos TypeScript generados y custom
│   └── hooks/                  # Hooks React custom
├── supabase/
│   └── migrations/             # Esquema incremental (fuente de verdad DB)
├── scripts/                    # Scripts Python para import retail, migraciones
├── public/                     # Assets estáticos
└── docs/                       # Documentación adicional
```

### Rutas principales (`src/app/(app)/`)

| Ruta | Rol |
|------|-----|
| `/dashboard` | Resumen ejecutivo del perfil activo |
| `/inventory` | Inventario del hogar (`products` + stock) |
| `/catalog` | Catálogo maestro (`catalog_products`) |
| `/capture` | Alta asistida por foto → `products` |
| `/receipts` | Boletas / tickets → `purchase_receipts` |
| `/stock-checks` | Inventario físico por zona |
| `/history` | Movimientos de stock (`stock_movements`) |
| `/consumption` | Registro de consumo |
| `/shopping-list` | Lista de compras |
| `/supermarket` | Vista supermercado (modo manos libres) |
| `/users` | Equipo e invitaciones |
| `/settings` | Ajustes del perfil |
| `/menu` | Índice de módulos |
| `/style-lab` | Demo de estilos (dev only) |

---

## Arquitectura de Datos

### Concepto Central: Dos Mundos

#### 1. Mundo Global (Catálogo)

Información común para todos los perfiles. No representa stock personal.

| Tabla | Rol |
|-------|-----|
| `catalog_products` | Productos maestros (nombres estándar, referencia global) |
| `catalog_brands` | Marcas del catálogo |
| `catalog_product_aliases` | Nombres alternativos para búsqueda tolerante |
| `catalog_product_media` | Imágenes/medios de productos |
| `sections` | Pasillo / rubro comercial (ej. alimentos, limpieza) |
| `categories` | Subcategoría dentro de una sección |

#### 2. Mundo del Perfil (Ubicación)

Información propia de una casa o unidad de inventario (`profiles`). Representa stock real.

| Tabla | Rol |
|-------|-----|
| `profiles` | Ubicaciones (Casa Cristian, Departamento, Oficina) |
| `profile_members` | Miembros del hogar / responsables |
| `products` | Ítems de inventario con stock (`stock_current`) |
| `stock_movements` | Bitácora central de movimientos |
| `stock_checks` | Chequeos de stock físico |
| `stock_check_photos` | Fotos de chequeo |
| `stock_check_detected_items` | Productos detectados por IA en chequeo |
| `purchase_receipts` | Boletas de compra |
| `purchase_receipt_items` | Líneas de boleta |
| `shopping_trips` | Viajes de compra planificados |
| `shopping_trip_items` | Ítems de lista de compras |

### Regla Clave: Taxonomía vs Zona Física

- **`sections` / `categories`**: Taxonomía **global/comercial** del catálogo. Se usan para clasificar productos y navegar.
- **Zona física**: Lista fija (`alacena`, `refrigerador`, `congelador`, `baño/aseo`, `bodega`, `otro`). Se guarda en `products.location` y `stock_checks.zone`.

> **Nunca mezclar** taxonomía de catálogo con zona física del hogar.

### Vínculo Catálogo → Inventario

Todo ítem de inventario (`products`) **debe** referenciar un producto maestro en `catalog_products` vía `catalog_product_id`. El nombre del ítem en inventario proviene del catálogo.

---

## Módulos Funcionales

### Dashboard
- Resumen de stock, productos con bajo stock, últimos movimientos, boletas, chequeos.
- Vista de impacto inicial; no es una lista infinita.

### Catálogo
- Buscar, navegar por categorías, crear y editar productos maestros.
- Asociar marcas, imágenes y alias.
- Si un producto no existe y se detecta desde foto o boleta, el sistema ofrece crearlo en el catálogo global.

### Inventario (`/inventory`)
- Grilla paginada en servidor (tamaño de página **100**).
- Alta **solo desde catálogo** (`catalog_product_id` obligatorio).
- Filtros por sección, categoría, estado activo/inactivo.
- Búsqueda: prefiltro server-side + refinamiento tipo Google en cliente.

### Captura IA (`/capture`)
- Flujo: Modelo OpenRouter → Zona física → Foto → Analizar.
- IA propone productos; el usuario confirma antes de impactar stock.
- Categoría/sección comercial por ítem (taxonomía global).
- Zona física se persiste en `products.location`.

### Boletas (`/receipts`)
- La IA lee la boleta; por cada línea busca producto global, alias e historial del perfil.
- Guardar borrador **no** impacta stock.
- Confirmación tras revisión y emparejamiento → registra `purchase` en `stock_movements`.
- Idempotencia por línea (`note = purchase_receipt_item:<line_id>`) para evitar doble ingreso.

### Chequeo de Stock (`/stock-checks`)
- Selección de zona física → fotos → IA detecta productos.
- Comparación: esperados vs encontrados vs faltantes vs sobrantes.
- Propone ajustes; el usuario confirma antes de aplicar.
- Ajustes se registran en `stock_movements` como `inventory_count`.

### Consumo (`/consumption`)
- Descuento de productos usados del inventario del perfil.
- Registra movimiento `consumption` en `stock_movements`.
- No crea productos ni consume sin stock disponible.

### Compras (`/shopping-list`, `/supermarket`)
- Listas de compra planificadas con sugerencias basadas en stock bajo.
- Modo supermercado: checkboxes grandes agrupados por pasillos.
- Finalización actualiza stock y registra movimientos `purchase`.

### Administración (`/users`, `/settings`, `/profiles/new`)
- Gestión de ubicaciones (`profiles`), miembros, invitaciones y permisos.
- Responsables salen de `profile_members`.

---

## Captura Retail (Scrapping de Cadenas)

El sistema soporta múltiples retailers para comparativa de precios:

### Retailers Soportados

| Retailer | Tipo | Base URL |
|----------|------|----------|
| **Lider** | HTML scraping | `https://super.lider.cl` |
| **Jumbo** | VTEX API | `https://www.jumbo.cl` |
| **Central Mayorista** | VTEX API | Variable de entorno |

### Tablas de Retail

| Tabla | Rol |
|-------|-----|
| `retail` | Configuración de retailers (base_url, max_pages, max_products) |
| `scrapping_runs` | Ejecuciones de scrapping |
| `scrapping_pages` | Cola de páginas a procesar |
| `scrapping` | Productos capturados por corrida |
| `catalog_retail_snapshots` | Precio + fecha por ítem de tienda |
| `catalog_retail_links` | Homologación: ítem tienda → `catalog_product_id` |

### Flujo de Scrapping

1. **Fase 1 (Enqueue)**: Descubrimiento de URLs de listado por retailer.
   - Líder: plan de catálogo Lider (URLs predecibles).
   - VTEX (Jumbo, Central Mayorista): URLs de búsqueda paginadas via VTEX API.
2. **Fase 2 (Seal)**: Sellar `total_pages` de la cola.
   - VTEX: cola completa desde Fase 1, solo sellar.
   - Líder: descubrimiento completo del catálogo y appending de URLs nuevas.
3. **Procesamiento**: Captura página por página, extracción de productos, inserción en `scrapping`.
4. **Homologación**: Matching automático con catálogo vía IA (OpenRouter) + matching DB (`pg_trgm`).

### Captura Masiva (fuera de la app)

Para volúmenes grandes (miles de ítems), usar los scripts Python:

```bash
# Import masivo de snapshots (no crea maestros por defecto)
python scripts/import_retail_snapshots.py --retailer jumbo
python scripts/import_retail_snapshots.py --retailer central_mayorista
python scripts/import_retail_snapshots.py --retailer lider --sqlite lider/productos_lider.db

# Homologación inteligente
python scripts/import_retail_snapshots.py --retailer jumbo --smart-resolve

# + alta de maestros nuevos controlada
python scripts/import_retail_snapshots.py --retailer jumbo --smart-resolve --create-if-novel
```

---

## Reglas Críticas

### Stock y Movimientos
- **Todo stock debe nacer desde movimientos.**
- Todo aumento de stock registra `stock_movements`.
- Todo consumo registra `stock_movements`.
- Todo ajuste por chequeo registra `stock_movements`.
- **Nunca** actualizar `products.stock_current` sin movimiento.

### IA
- La IA **propone**; el usuario **confirma**.
- Los resultados IA quedan en estado pendiente hasta revisión.
- La IA guarda sugerencias, no cambios definitivos.

### Base de Datos
- **La base existente manda.** Primero mapear, luego adaptar.
- **Nunca** crear tablas duplicadas.
- **Nunca** borrar tablas, columnas ni relaciones.
- **Nunca** modificar RLS sin diagnóstico.
- Migraciones no destructivas; esquema incremental en `supabase/migrations/`.

### Perfil Activo
- Todo módulo operativo usa `profile_id`.
- El catálogo global no depende de un perfil.

---

## Mejoras Recientes

### Multi-Retail Support (Mayo 2026)
- **Soporte para Jumbo y Central Mayorista** vía VTEX API (`fetch-vtex-search.ts`).
- **Adapter unificado** `retail-capture-adapter.ts`: decide automáticamente entre captura Lider (HTML) y VTEX (API) según el retailer.
- **Phase 1 y Phase 2** de scrapping generalizados para VTEX (URLs predecibles, sin descubrimiento adicional en Phase 2).
- **Rotación round-robin** de API keys OpenRouter con fallback automático ante rate limits (`OPENROUTER_API_KEYS`).
- **Limpieza** de imports sin usar y corrección de tipados TypeScript.

### Estabilidad de Stock y Movimientos
- Bitácora `stock_movements` como fuente de verdad; compensación automática si falla el insert del movimiento.
- Idempotencia en boletas (`purchase_receipt_item:<line_id>`) para evitar doble ingreso.

---

## Convenciones de UI/UX

- **Consultas < 1s**, paginación arriba y abajo.
- **Botones de ancho uniforme** en modales.
- **Acciones de fila:** solo ícono + tooltip.
- **Combobox inteligente:** búsqueda remota ≥2 caracteres, debounce ~320ms, máx 50 resultados.
- **Búsqueda estándar:** Enter + lupa **dentro** de la caja de texto.
- **Errores:** mensajes amigables vía `getUserFriendlyErrorMessage` (sin textos técnicos crudos al usuario).
- **Navegación:** menú lateral jerárquico con grupos funcionales.

---

## Comandos de Validación

```bash
npm run build      # Build completo (incluye typecheck de Next.js)
npm run lint       # ESLint
```

> Si `npm run typecheck` no existe, Next.js valida tipos dentro del build.

---

## Forma de Trabajo

1. **Diagnóstico** — entender el problema y mapear contra la base actual.
2. **Mapeo** — identificar tablas, columnas y relaciones existentes.
3. **Brechas** — qué falta y si ya existe algo equivalente.
4. **Plan por etapas** — cambios pequeños y validables.
5. **Archivos a modificar** — lista explícita.
6. **Riesgos** — impacto en RLS, migraciones, datos existentes.
7. **Cambios** — implementación mínima y enfocada.
8. **Validación** — build, lint y pruebas manuales.
9. **Reporte** — archivos, tablas, rutas, migraciones, errores pendientes, riesgos.

---

## Licencia

Privado — Uso exclusivo del propietario del proyecto.
