# Estado del proyecto — reporte

Última actualización: 2026-05-06 (Etapa 2 — cierre corregido).

## Etapa 1 — corrección final (navegación jerárquica)

### Objetivo

Menú lateral y página **Menú** alineados con `PROJECT_CONTEXT.md`: grupos con sub-enlaces (Catálogo, Inventario, Consumo, Chequeo de stock, Compras, Administración), más Configuración al mismo nivel; sin ítem suelto «Equipo», sin **Estilos (demo)** en el menú normal del usuario (solo ruta técnica `/style-lab` enlazada desde el bloque dev del shell cuando aplica).

### Cambios realizados

| Archivo | Detalle |
|---------|---------|
| `src/lib/navigation.ts` | `navigationTree` (`NavNode` / `NavChild`), `mobileBottomNavItems` (Dashboard, Inventario, Consumo, Compras, Menú), `navLinkIsActive`. Sin lista plana previa. |
| `src/components/layout/AppShell.tsx` | Renderizado por grupos + sub-enlaces; barra móvil con estado activo vía `navLinkIsActive`; sin Estilos en nav principal. |
| `src/app/(app)/menu/page.tsx` | Lista jerárquica según `navigationTree`. |
| `src/app/(app)/users/TeamPageClient.tsx` | `id="admin-invitaciones"` y `id="admin-personas"` + `scroll-mt-24` para anclas de Administración. |
| `src/app/(app)/stock-checks/StockChecksClient.tsx` | `id="stock-check-nuevo"` y `id="stock-check-historial"` para anclas del menú de chequeo. |

### Rutas

Todas las rutas existentes se conservan. No hay rutas nuevas. Donde no hay pantalla separada (p. ej. Marcas/Categorías del catálogo), los enlaces apuntan a `/catalog` (misma vista).

### Tablas / migraciones

Ninguna.

### Validaciones (2026-05-06)

| Comando | Resultado |
|---------|-----------|
| `npm run build` | **Correcto** (exit code 0). |
| `npm run lint` | **Falló** (exit code 1). Errores **preexistentes** (`react-hooks/set-state-in-effect`, etc.); no atribuibles a esta corrección de navegación. |

---

## Histórico (referencia)

Iteraciones anteriores de la Etapa 1 / 1.1 (lista plana o agrupación parcial) quedaron sustituidas por la **corrección final** anterior.

---

## Riesgo residual

**Bajo.** Varias entradas comparten URL (`/catalog`, `/receipts`) con distinta etiqueta; el estado activo puede coincidir en varias líneas cuando el path es el mismo sin fragmento.

---

## Estado de cierre Etapa 1

1. **Etapa 1 cerrada** — incluye la corrección final de navegación jerárquica (`navigationTree`, sidebar y página Menú).
2. **Build correcto** — según validación registrada (`npm run build`, exit code 0).
3. **Base de datos sin cambios** — ninguna modificación de esquema ni datos por esta etapa.
4. **Migraciones sin cambios** — no se añadieron ni alteraron migraciones SQL.
5. **Lint pendiente** — fallos por errores **preexistentes** del repo (no atribuibles a la navegación).
6. **Riesgo residual** — enlaces que comparten la misma ruta con etiquetas distintas (p. ej. `/catalog`, `/receipts`).
7. **Próxima acción** — prueba manual del menú (lateral, móvil y página Menú) antes de definir la siguiente etapa de trabajo.

---

## Etapa 2 completada: separación funcional de módulos

### Objetivo

Alinear títulos y textos visibles de cada pantalla con el rol funcional del módulo definido en la navegación jerárquica (Etapa 1) y en `PROJECT_CONTEXT.md`: Dashboard ejecutivo, Catálogo sin stock como foco, Inventario como stock/carga, Consumo como descuento e historial asociado, Chequeo como comparación/ajustes, Compras como planificación/tiendas/historial de tickets, Administración vs Configuración, y Laboratorio solo como herramienta técnica.

### Archivos modificados

| Archivo |
|---------|
| `src/lib/domain.ts` |
| `src/app/(app)/dashboard/page.tsx` |
| `src/app/(app)/consumption/page.tsx` |
| `src/app/(app)/history/page.tsx` |
| `src/app/(app)/catalog/page.tsx` |
| `src/app/(app)/capture/page.tsx` |
| `src/app/(app)/capture/CaptureView.tsx` |
| `src/app/(app)/stock-checks/page.tsx` |
| `src/app/(app)/settings/page.tsx` |
| `src/app/(app)/profiles/new/page.tsx` |
| `src/app/(app)/style-lab/page.tsx` |
| `src/app/(app)/users/TeamPageClient.tsx` |
| `src/app/(app)/menu/page.tsx` |

### Rutas tocadas (solo copy / títulos / leads)

`/dashboard`, `/consumption`, `/history`, `/catalog`, `/capture`, `/stock-checks`, `/settings`, `/profiles/new`, `/style-lab`, `/users` (cliente); texto de ayuda en `/menu`. Sin cambios de path ni redirecciones.

### Tablas involucradas

Ninguna.

### Migraciones

Ninguna.

### Validaciones

| Comando | Resultado |
|---------|-----------|
| `npm run build` | **Correcto** (exit code 0). |
| `npm run lint` | **Falló** (exit code 1). Errores **preexistentes** en otros archivos; aviso de import resuelto en dashboard tras usar `PAGE_LEADS.dashboard`. |

### Errores pendientes

Lint global sigue fallando por reglas `react-hooks/set-state-in-effect` y warnings ya conocidos fuera del alcance de esta etapa.

### Riesgo residual

Siguen existiendo rutas compartidas entre menú y funciones (p. ej. `/catalog`, `/receipts`) como en Etapa 1.

**Cierre Etapa 2 (corrección):** Se corrigió el nombre visible de `/history` para evitar confusión entre «historial de consumo» y el registro general de movimientos de stock (la vista lista todos los tipos; el ítem de menú bajo Consumo enlaza a esta misma ruta con la etiqueta **Historial de stock**).
