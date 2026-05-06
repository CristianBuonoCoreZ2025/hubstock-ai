# Modelo del producto (dominio)

Referencia para desarrollo y soporte. Las cadenas visibles al usuario se centralizan en `src/lib/domain.ts` (`PAGE_LEADS`, `movementTypeLabel`).

---

## 1. Perfil (hogar)

Un **perfil** (`profiles`) es el contenedor operativo: inventario, boletas y movimientos son **por perfil**. Cambiar el perfil activo cambia todos esos datos.

---

## 2. Taxonomía de producto (global vs hogar)

Son **las mismas etiquetas** en toda la app; lo que cambia es si la fila lleva stock o no.

| Concepto | Tabla / origen | ¿Stock? | Rol |
|----------|----------------|---------|-----|
| **Sección** | `sections` | — | Pasillo / ámbito de compra (ej. *Lácteos*). Global, compartida. |
| **Categoría** | `categories` (pertenece a una sección) | — | Subtipo dentro del pasillo (muchas veces *General*). Global. |
| **Producto maestro** | `catalog_products` (+ `catalog_product_aliases`) | No | Plantilla de nombre, presentación y precio referencia. Sirve para copiar al hogar y para emparejar texto. |
| **Producto del hogar** | `products` | Sí (`stock_current`, etc.) | Instancia en el hogar: referencia **obligatoria** a un maestro vía `catalog_product_id` en el flujo manual de `/inventory`; `section_id` + `category_id` son la taxonomía comercial del ítem. |

**Confusión habitual:** “¿Inventario crea productos?”  
El **maestro** siempre vive en `catalog_products`. Desde inventario puedes **vincular** uno existente o, en el mismo flujo, **crear el maestro + la fila del perfil** (nombre estándar único), con los mismos permisos que editar catálogo.

---

## 3. Pantallas y qué problema resuelven

| Pantalla | Ruta | Qué hace | No es |
|---------|------|----------|--------|
| **Inventario** | `/inventory` | CRUD y stock del hogar (`products`). Fuente de verdad operativa. | No es el maestro global. |
| **Catálogo** | `/catalog` | Lee `catalog_products`; “copiar al perfil” crea/alinea `products`. | No muestra cantidades ni stock por hogar hasta copiar/linkear. |
| **Captura IA** | `/capture` | Foto → IA → alta/revisión hacia **`products`** del perfil activo. | No reemplaza boletas ni historial de movimientos. |
| **Boletas** | `/receipts` | Ticket de compra (`purchase_receipts` / ítems) y emparejar con inventario tras revisión. | No lista movimientos de stock consolidados por ítem día a día (eso es **Historial**). |
| **Historial de stock** | `/history` | `stock_movements`: entradas/salidas registradas (`delta`, `movement_type`). | No muestra texto crudo del ticket ni estado de borrador de boleta. |
| **Chequeo de stock** | `/stock-checks` | Inventario físico por fotos/zona; líneas pendientes hasta confirmar. | No es la lista simple de Captura única-producto ni la boleta. |

---

## 4. “Captura” vs “Boletas” vs “Chequeo”

- **Captura:** un ítem/producto típico, una foto enfocada, confirmación rápido al inventario.
- **Boletas:** muchas líneas de un mismo documento fiscal, flujo revisión ↔ productos ya existentes.
- **Chequeo:** zonas/stock físico cantidad/conteo, modelo de “lista de trabajo” hasta confirmación.

Todos pueden usar **las mismas secciones/categorías** porque al final referencian `products`.

---

## 5. Flujo recomendado (usuario nuevo)

1. Definir o copiar bases desde **Catálogo** si quieres nombres alineados.  
2. Operar día a día en **Inventario** (cantidades/mínimos).  
3. **Captura IA** solo para nuevos ítems puntuales.  
4. **Boletas** cuando el origen sea un ticket.  
5. **Historial** para auditar variaciones de stock; **Chequeo** para inventarios por zona.

---

## 6. Orden en código (ver también `src/lib/navigation.ts`)

- **App:** `src/app/(app)/*` — cada carpeta = ruta.  
- **Acciones:** `src/app/actions/*` — mutaciones y lecturas server.  
- **Dominio / copy:** `src/lib/domain.ts`.  
- **Supabase:** `supabase/migrations/*.sql` — única fuente de esquema incremental.
