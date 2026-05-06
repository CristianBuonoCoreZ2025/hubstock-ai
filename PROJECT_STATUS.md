# Estado del proyecto — reporte

Última actualización: 2026-05-06 (Etapa 4 — boletas e inventario).

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
| `npm run build` | **Correcto** (exit code 0), tras el cierre Etapa 2. |
| `npm run lint` | **Falló** (exit code 1). Errores **preexistentes** en otros archivos; aviso de import resuelto en dashboard tras usar `PAGE_LEADS.dashboard`. |

### Errores pendientes

Lint global sigue fallando por reglas `react-hooks/set-state-in-effect` y warnings ya conocidos fuera del alcance de esta etapa.

### Riesgo residual

Siguen existiendo rutas compartidas entre menú y funciones (p. ej. `/catalog`, `/receipts`) como en Etapa 1.

**Cierre Etapa 2 (corrección):** «Se corrigió el nombre de `/history` para evitar confusión entre historial de consumo y movimientos generales de stock.» Título visible e ítem de menú: **Historial de stock**; lead actualizado en `PAGE_LEADS.history`. Archivos tocados en este cierre: `src/lib/domain.ts`, `src/lib/navigation.ts`, `src/app/(app)/history/page.tsx`.

---

## Etapa 3 completada: revisión de stock_movements

### Objetivo

Usar `stock_movements` como bitácora obligatoria ante cualquier cambio de `products.stock_current` desde la app (salvo lo ya cubierto por otros flujos), sin migraciones ni cambios de RLS.

### Diagnóstico breve

La tabla acumulada es `products.stock_current`. Los movimientos se listan en `/history` desde `stock_movements`. Antes de esta etapa, **alta manual**, **edición de cantidad** y **captura con stock inicial** escribían solo `products` sin fila de movimiento. Consumo, boletas confirmadas, viaje de compras y cierre de chequeo ya insertaban movimientos. Los tipos en BD son un `CHECK` cerrado; no se añadieron nuevos valores.

### Columnas reales de `stock_movements` (migración `stockcasa_core`)

`id`, `profile_id`, `product_id`, `delta`, `movement_type`, `note`, `reference_id`, `created_by`, `created_at`.

### Tipos de movimiento (constraint)

`consumption`, `purchase`, `adjustment`, `import`, `inventory_count`.

### Flujos que ya usaban `stock_movements`

- `consumeProduct` (inventario / consumo) — `consumption`
- `receipts.ts` al confirmar boleta — `purchase`
- `shopping.ts` al finalizar viaje — `purchase`
- `stock-checks.ts` al aplicar chequeo — `inventory_count`

### Flujos corregidos en esta etapa

- **addProduct** — si `stock_current > 0` al crear: `import` + nota de alta manual
- **updateProduct** — si cambia la cantidad: `adjustment` con delta = nuevo − anterior
- **addProductFromCapture** — si `stock_current > 0`: `import` + nota de captura

### Flujos pendientes / fuera de alcance en código (antes del cierre 3.1)

- **RPC `copy_catalog_products_to_profile`**: verificado en migración vigente — inserta **`stock_current = 0`** siempre; no genera movimiento inicial y es coherente con la bitácara (ver Etapa 3.1).
- No existe tipo dedicado «carga por boleta» separado de `purchase`; sigue siendo `purchase` al confirmar en `receipts.ts`.

### Archivos modificados

| Archivo |
|---------|
| `src/app/actions/inventory.ts` |
| `src/app/actions/capture.ts` |
| `src/lib/domain.ts` |

### Tablas involucradas

`products`, `stock_movements` (solo lectura/insert desde cliente existente).

### Migraciones

Ninguna.

### Validaciones

| Comando | Resultado |
|---------|-----------|
| `npm run build` | **Correcto** (exit code 0). |
| `npm run lint` | **Falló** (exit code 1). Errores **preexistentes** en otros archivos; sin nuevos hallazgos en `inventory.ts`, `capture.ts` ni `domain.ts` de esta etapa. |

### Errores pendientes

Lint global por archivos no modificados en esta etapa.

### Riesgo residual

Si falla el `insert` en `stock_movements` tras crear o actualizar producto, el código devuelve error aunque `products` pueda haberse actualizado (sin transacción atómica en el cliente). ~~Copia desde catálogo vía RPC no auditada en esta etapa.~~ *(Aclarado en Etapa 3.1: RPC con stock 0.)*

---

## Etapa 3.1: cierre técnico de stock_movements

### Objetivo

Cerrar formalmente el trabajo de bitácora: verificar contratos con BD, eliminar dudas sobre RPC de catálogo y dejar reglas y riesgos explícitos sin nueva migración ni cambio de RLS.

### Verificaciones realizadas

| Verificación | Resultado |
|--------------|-----------|
| Constraint `movement_type` en BD | Cinco valores fijos; sin ampliación en app (correcto según reglas Etapa 3). |
| RPC `copy_catalog_products_to_profile` (`20260515120000_catalog_brands.sql`) | Inserta productos con **`stock_current = 0`** (literal en `SELECT`). No requiere fila en `stock_movements` para la copia inicial. |
| Rutas de revalidación tras movimiento | Inventario/captura/consumo refrescan `/history` donde aplica; boletas, compras y chequeo ya revalidaban según flujo. |

### Contrato resumido (app → BD)

| Origen funcional | `movement_type` | Notas típicas en código |
|------------------|-------------------|---------------------------|
| Consumo | `consumption` | `consumeProduct` |
| Boleta / compra confirmada | `purchase` | `receipts.ts`, `shopping.ts` |
| Chequeo aplicado | `inventory_count` | `stock-checks.ts` |
| Alta manual o captura con cantidad inicial | `import` | `addProduct`, `addProductFromCapture` |
| Cambio manual de cantidad en ficha | `adjustment` | `updateProduct` |

### Limitación técnica aceptada

El cliente Supabase en server actions no ejecuta transacción única `products` + `stock_movements`. Si el segundo paso falla, puede existir divergencia hasta corrección manual; el código devuelve error explícito cuando detecta fallo en el insert del movimiento.

### Archivos tocados en 3.1

| Archivo | Detalle |
|---------|---------|
| `PROJECT_STATUS.md` | Sección 3.1 y corrección del pendiente RPC en texto de Etapa 3. |
| `src/app/actions/catalog.ts` | Comentario JSDoc enlazando comportamiento de stock 0 con la RPC en migraciones. |

### Migraciones / tablas

Ninguna.

### Validaciones

No se repitieron build/lint solo por documentación; el último estado conocido sigue siendo build OK y lint global con errores heredados.

### Riesgo residual (3.1)

Misma limitación transaccional que Etapa 3. La copia desde catálogo **no** introduce stock oculto sin movimiento (stock inicial siempre 0 en RPC vigente).

---

## Etapa 3.2 completada: cierre técnico de consistencia stock_movements

### Objetivo

Evitar que `products.stock_current` quede modificado o positivo sin una fila correspondiente en `stock_movements` cuando el insert del movimiento falla tras crear o actualizar el producto (sin RPC nueva, sin migraciones, sin cambios de RLS).

### Archivos modificados

| Archivo | Detalle |
|---------|---------|
| `src/app/actions/inventory.ts` | `addProduct`: si falla `stock_movements` tras alta con stock \> 0, actualiza el producto a `stock_current = 0`. `updateProduct`: si falla el movimiento tras cambiar cantidad, revierte `stock_current` al valor leído antes del update. |
| `src/app/actions/capture.ts` | `addProductFromCapture`: mismo criterio que alta manual — si falla el movimiento, deja `stock_current = 0`. |
| `src/lib/domain.ts` | Comentario de documentación sobre la compensación en server actions (Etapa 3.2). |
| `PROJECT_STATUS.md` | Esta sección y fecha de última actualización. |

### Comportamiento corregido

| Flujo | Antes | Después |
|-------|--------|---------|
| Alta manual con cantidad inicial \> 0 | Podía quedar producto con stock \> 0 y sin movimiento si fallaba el insert. | Tras fallo del movimiento, `stock_current` pasa a **0** en ese producto; mensaje de error explícito. |
| Edición con cambio de cantidad | Podía quedar stock nuevo sin movimiento si fallaba el insert. | Tras fallo del movimiento, **reversión** de `stock_current` al valor previo al update. |
| Captura con cantidad \> 0 | Igual riesgo que alta manual. | Igual que alta manual: **0** si no se puede registrar el movimiento. |

### Validaciones reales (2026-05-06)

| Comando | Resultado |
|---------|-----------|
| `npm run build` | **Correcto** (exit code 0). |
| `npm run lint` | **Falló** (exit code 1). Errores **preexistentes** en otros archivos (`react-hooks/set-state-in-effect`, etc.); sin hallazgos en `inventory.ts`, `capture.ts` ni `domain.ts` de esta etapa. |

### Riesgo residual actualizado

**Medio-bajo.** Sigue sin haber transacción única en el cliente Supabase: entre el update de compensación y un fallo extremo de red podría quedar un estado intermedio raro; no hay RPC transaccional. Otros flujos que actualicen `products` y luego `stock_movements` (p. ej. `consumeProduct`) no forman parte de esta etapa. La copia desde catálogo sigue con stock inicial 0 en la RPC vigente.

### Migraciones

**Ninguna** — no se ejecutaron migraciones ni se alteró el esquema.

### RLS

**Sin cambios** — no se modificaron políticas ni permisos en esta etapa.

---

## Etapa 4 completada: boletas e inventario

### 1. Objetivo

Alinear el flujo de boletas con **carga controlada**: el inventario solo cambia tras **revisión y confirmación** explícita; bitácora `stock_movements` con `movement_type = purchase` sin duplicar ingresos por reintentos ni dejar stock sin movimiento cuando falle el insert (compensación como Etapa 3.2).

### 2. Diagnóstico breve (antes de correcciones)

| # | Hallazgo |
|---|-----------|
| 1–2 | Ver subsecciones **Columnas reales** y **Estados** más abajo (migraciones `stockcasa_core` + `product_catalog_open_food_facts`). |
| 3 | La boleta se crea en `savePurchaseReceiptDraft` (`src/app/actions/receipts.ts`). |
| 4 | Los ítems detectados se insertan en `purchase_receipt_items` en el mismo flujo de borrador. |
| 5 | La confirmación que impacta inventario es `confirmPurchaseReceipt` (`receipts.ts`). |
| 6–7 | `products.stock_current` (y opcionalmente `last_price`) solo se actualizaban en `confirmPurchaseReceipt`; `stock_movements` solo ahí para boletas. |
| 8 | Existía chequeo `status === 'pending_review'` antes de aplicar; **no** había idempotencia por línea ni `UPDATE` de boleta condicionado al estado → riesgo de **doble ingreso** si fallaba el paso final o se reintentaba tras aplicar líneas. |
| 9 | Los ítems quedan en BD al crear el borrador; `purchase_receipts.status = pending_review` hasta confirmar. |
| 10 | No hay FK ni columna a `catalog_products` en líneas de boleta. |
| 11 | `purchase_receipt_items.product_id` referencia `products` (nullable hasta emparejar). |
| 12 | `catalog_product_aliases` **no** se usa en el flujo de boletas revisado. |
| 13 | No hay `section_id` en `purchase_receipt_items`; la ubicación del hogar sigue en `products` / taxonomía al elegir producto. |
| 14 | Archivos involucrados: `receipts.ts`, `ReceiptsClient.tsx`, `page.tsx` en `receipts`, `PAGE_LEADS` en `domain.ts`; API `analyze-receipt` solo analiza imagen (sin escribir stock). |
| 15 | **Riesgo previo:** actualizar stock y fallar `stock_movements` dejaba stock inflado; confirmar tras fallo parcial podía **volver a sumar** cantidades; dos pestañas confirmando en paralelo podían duplicar (sin bloqueo fuerte en BD). |

### 3. Columnas reales de `purchase_receipts`

Según `supabase/migrations/20260501120000_stockcasa_core.sql` y tipos en `src/types/database.ts`:

`id`, `profile_id`, `store_name`, `purchased_at`, `total`, `image_storage_path`, `raw_analysis`, `status`, `created_by`, `created_at`, `updated_at`.

### 4. Columnas reales de `purchase_receipt_items`

Núcleo (`stockcasa_core`): `id`, `receipt_id`, `product_id`, `name_raw`, `quantity`, `unit_price`, `line_total`, `sort_order`.

Ampliación (`20260504100000_product_catalog_open_food_facts.sql`): `gtin`, `enrichment` (jsonb).

### 5. Estados

- **Boleta (`purchase_receipts.status`):** `pending_review` \| `confirmed` \| `rejected` (CHECK en migración).
- **Ítems:** sin columna de estado; el pendiente operativo es la boleta en `pending_review` y líneas sin `product_id` hasta emparejar.

### 6. Flujo actual de boletas (tras correcciones)

1. Usuario analiza imagen (cliente → `/api/ai/analyze-receipt`) y opcionalmente edita metadatos.
2. **Guardar borrador:** insert en `purchase_receipts` con `status = pending_review` e ítems en `purchase_receipt_items` (**sin** tocar `products` ni `stock_movements`).
3. Usuario abre revisión, empareja líneas con `products` del perfil (`setReceiptLineProduct`).
4. **Confirmar:** por cada línea emparejada con cantidad válida, si no existe ya el movimiento idempotente, se suma stock y se inserta `stock_movements` (`purchase`). Si falla el movimiento, se revierte `stock_current` y `last_price` en ese producto. Al final, la boleta pasa a `confirmed` solo si seguía `pending_review`.

### 7. Correcciones aplicadas

| Área | Cambio |
|------|--------|
| Consistencia stock / movimiento | Tras fallo del insert en `stock_movements`, reversión de `stock_current` y `last_price` al valor previo en esa línea (misma idea que Etapa 3.2). |
| Idempotencia / doble movimiento | `note` estable por línea: `purchase_receipt_item:<line_id>` + filtros por `reference_id`, `movement_type`, `product_id`; líneas ya aplicadas se omiten en reintentos. |
| Doble confirmación | `UPDATE purchase_receipts … confirmed` solo con `.eq('status', 'pending_review')`; si otro proceso ya confirmó, se trata como éxito idempotente si el estado es `confirmed`. |
| Copy / UX | `PAGE_LEADS.receipts` y texto en `ReceiptsClient` aclaran que guardar solo crea borrador sin cambiar inventario. |
| Comentario código | En `savePurchaseReceiptDraft`, aclaración de que no hay impacto en stock hasta confirmar. |

### 8. Protección contra doble confirmación

- Rechazo si `receipt.status !== 'pending_review'` al inicio.
- Cierre con actualización condicional a `confirmed` solo desde `pending_review`.
- Idempotencia por línea para evitar segundo ingreso por el mismo ítem en reintentos.

*(Dos confirmaciones concurrentes desde clientes distintos siguen siendo una condición de carrera teórica sin bloqueo pesimista en BD → ver riesgo residual.)*

### 9. Uso de `stock_movements`

Una fila por línea de boleta aplicada: `movement_type = purchase`, `reference_id = receiptId`, `note = purchase_receipt_item:<item_uuid>`, `delta = cantidad`, `product_id` del inventario del perfil.

### 10. Uso de `products` y `catalog_products`

- **`products`:** destino del stock y del vínculo por línea (`product_id`).
- **`catalog_products`:** no participa en el modelo de boleta actual; alta controlada de productos nuevos desde boleta **no** está implementada en este flujo (el usuario debe tener el ítem en inventario o crearlo por otros módulos).

### 11. Uso de `sections`

Sin campo en líneas de boleta; la sección del hogar sigue definida en el producto (`products.section_id` / categorías) al elegir el producto emparejado.

### 12. Flujos pendientes

- Creación **desde boleta** de un producto nuevo (wizard / catálogo) sin rediseño grande.
- Enriquecimiento OFF (`gtin` / `enrichment` en ítems) sin uso obligatorio en UI de esta etapa.
- Condición de carrera entre dos confirmaciones simultáneas (mitigar en etapa futura con RPC transaccional o bloqueo).

### 13. Archivos modificados

| Archivo |
|---------|
| `src/app/actions/receipts.ts` |
| `src/lib/domain.ts` |
| `src/app/(app)/receipts/ReceiptsClient.tsx` |
| `PROJECT_STATUS.md` |

### 14. Tablas involucradas

`purchase_receipts`, `purchase_receipt_items`, `products`, `stock_movements`, `profiles` (vía `profile_id` en cabecera). Referenciadas en políticas pero **sin cambiar RLS**: `catalog_products`, `catalog_product_aliases`, `sections` no recibieron cambios de esquema ni nuevas relaciones en esta etapa.

### 15. Migraciones

**Ninguna** ejecutada ni añadida en esta etapa.

### 16. Validaciones reales (2026-05-06)

| Comando | Resultado |
|---------|-----------|
| `npm run build` | **Correcto** (exit code 0). |
| `npm run lint` | **Falló** (exit code 1). Errores **preexistentes** en otros archivos; sin nuevos hallazgos en los archivos modificados de esta etapa. |

### 17. Errores pendientes

Lint global del repo (p. ej. `react-hooks/set-state-in-effect`) fuera del alcance de Etapa 4.

### Riesgo residual

**Medio-bajo.** Sin transacción única en servidor de aplicación: ventana pequeña entre updates; dos confirmaciones paralelas podrían duplicar cantidades en teoría. Movimientos antiguos con `note = null` no son idempotentes por línea si se reejecutara lógica antigua sobre datos viejos — las nuevas confirmaciones usan `note` fijo. No se alteró RLS ni esquema.
