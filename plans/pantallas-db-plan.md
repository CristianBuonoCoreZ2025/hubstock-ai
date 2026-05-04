# Plan de Desarrollo: Integración de Pantallas con Base de Datos

Este documento detalla la estrategia para reemplazar los datos mockeados y conectar las pantallas principales de la aplicación con Supabase, asegurando que todas las operaciones respeten el contexto del **perfil activo** (hogar) y las políticas de seguridad (RLS).

## Principios Generales
1. **Contexto de Perfil:** Todas las consultas (SELECT, INSERT, UPDATE, DELETE) deben filtrar o incluir el `profile_id` activo, obtenido desde la cookie `stockcasa_profile_id` o el contexto del servidor.
2. **Server Actions:** Las mutaciones de datos se realizarán mediante Server Actions en `src/app/actions/` para mantener la seguridad y aprovechar la revalidación de caché de Next.js.
3. **Data Fetching:** Las lecturas se harán preferentemente en Server Components, pasando los datos iniciales a Client Components si requieren interactividad.
4. **Tipado Estricto:** Utilizar los tipos generados en `src/types/database.ts`.

---

## Fase 0: Identidad Visual y Sistema de Diseño (Broadcasting de Élite)
Esta fase establece el estándar estético de toda la plataforma antes de conectar la lógica.

1. Sistema de Estilos Globales
Objetivo: Implementar una identidad visual cohesiva que elimine la necesidad de ajustes manuales por página.

Estética "Glassmorphism":

Contenedores: Fondos en bg-white/10 o bg-slate-900/40 con backdrop-blur-md.

Bordes: border border-white/20 para simular el grosor y brillo del cristal.

Profundidad: Uso de shadow-2xl y elevación mediante capas.

Tipografía Premium:

Fuente: Configuración global de "Plus Jakarta Sans" o "Inter".

Escalado: Títulos en font-bold con tracking-tight; cuerpo en font-medium.

Archivos Clave: globals.css, tailwind.config.ts, y src/components/ui/.

Acciones:

    Crear un Layout Universal que aplique estos estilos de forma automática.

    Asegurar que la UI sea fluida y responsiva con ajustes automáticos para cualquier resolución.


## Fase 1: Fundamentos del Inventario


### 1. Inventario (`/inventory`)
*   **Objetivo:** Visualizar, agregar, editar y eliminar productos del hogar.
*   **Tablas:** `products`, `categories`, `sections`.
*   **Acciones (Server Actions):**
    *   `getProducts(profileId)`: Obtener lista de productos activos.
    *   `addProduct(data)`: Crear nuevo producto.
    *   `updateProduct(id, data)`: Modificar producto existente.
    *   `deleteProduct(id)`: Marcar producto como inactivo (soft delete) o eliminar.
*   **UI:** Tabla o grid de tarjetas con filtros por sección/categoría y estado de stock (normal, bajo, crítico).

### 2. Consumo (`/consumption`)
*   **Objetivo:** Registrar rápidamente cuando se consume un producto para descontarlo del inventario.
*   **Tablas:** `products` (actualizar `stock_current`), `stock_movements` (registrar el evento).
*   **Acciones:**
    *   `consumeProduct(productId, quantity)`: Reduce el stock y crea un registro en `stock_movements` con tipo `consumption`.
*   **UI:** Interfaz rápida (tipo escáner o botones grandes) para descontar unidades.

---

## Fase 2: Abastecimiento y Compras

### 3. Lista de Compras (`/shopping-list`)
*   **Objetivo:** Planificar las compras. Generación automática basada en stock bajo y adiciones manuales.
*   **Tablas:** `shopping_trips` (estado 'draft'), `shopping_trip_items`, `products`.
*   **Acciones:**
    *   `getActiveShoppingList(profileId)`: Obtiene o crea un viaje de compras en estado borrador.
    *   `addItemToList(tripId, productId, quantity)`: Agrega un ítem.
    *   `generateAutoList(profileId)`: Agrega productos cuyo `stock_current` <= `stock_min`.
*   **UI:** Lista interactiva donde se pueden ajustar cantidades antes de ir al supermercado.

### 4. Supermercado (`/supermarket`)
*   **Objetivo:** Modo "manos libres" para usar durante la compra física.
*   **Tablas:** `shopping_trips` (estado 'in_progress'), `shopping_trip_items`.
*   **Acciones:**
    *   `startShoppingTrip(tripId)`: Cambia estado a en progreso.
    *   `checkItem(itemId, isChecked, price)`: Marca un ítem como en el carrito.
    *   `finishShoppingTrip(tripId)`: Finaliza el viaje, actualiza el stock de los productos comprados y registra movimientos.
*   **UI:** Lista agrupada por secciones (pasillos del supermercado) con checkboxes grandes.

---

## Fase 3: Automatización e IA

### 5. Captura (`/capture`)
*   **Objetivo:** Agregar productos nuevos al inventario tomando una foto.
*   **Tablas:** `products`, `product_images`.
*   **Flujo:**
    *   Subir imagen a Supabase Storage.
    *   Llamar a `/api/ai/analyze-product` para extraer nombre, marca, formato.
    *   Confirmar datos y guardar en BD.

### 6. Boletas (`/receipts`)
*   **Objetivo:** Digitalizar boletas para actualizar stock y precios automáticamente.
*   **Tablas:** `purchase_receipts`, `purchase_receipt_items`, `products`, `stock_movements`.
*   **Flujo:**
    *   Subir foto de boleta.
    *   Llamar a `/api/ai/analyze-receipt` para extraer ítems y precios.
    *   Interfaz para emparejar ítems de la boleta con productos del inventario.
    *   Confirmar: actualiza stock, precios de referencia y guarda la boleta.

### 7. Chequeo de Stock (`/stock-checks`)
*   **Objetivo:** Auditoría rápida tomando fotos de la despensa/refrigerador.
*   **Tablas:** `stock_checks`, `stock_check_photos`, `stock_check_detected_items`.
*   **Flujo:**
    *   Subir fotos de una zona.
    *   Llamar a `/api/ai/stock-check` para detectar productos y cantidades.
    *   Revisar sugerencias de la IA y aplicar ajustes al inventario.

---

## Fase 4: Gestión y Administración

### 8. Historial (`/history`)
*   **Objetivo:** Ver el registro de todos los movimientos de inventario.
*   **Tablas:** `stock_movements` (con joins a `products` y `auth.users`).
*   **Acciones:**
    *   `getMovements(profileId, filters)`: Obtener historial paginado.
*   **UI:** Tabla cronológica detallando quién hizo qué (consumo, compra, ajuste manual).

### 9. Equipo (`/users` o `/team`)
*   **Objetivo:** Gestionar los miembros del hogar.
*   **Tablas:** `profile_members`, `invitations`.
*   **Acciones:**
    *   `getMembers(profileId)`: Listar miembros actuales.
    *   `inviteUser(email, role)`: Crear invitación.
    *   `updateMemberRole(userId, role)` / `removeMember(userId)`.
*   **UI:** Lista de usuarios con selectores de rol y botón para invitar.

### 10. Configuración (`/settings`)
*   **Objetivo:** Ajustes generales del perfil.
*   **Tablas:** `profiles`.
*   **Acciones:**
    *   `updateProfile(data)`: Cambiar nombre o descripción del hogar.
*   **UI:** Formulario simple de edición.

---

## Orden de Ejecución Recomendado
0.  **Fase 0 (Interfaz):** Es lo que define el estandar de la aplicacion y la navegacion.
1.  **Fase 1 (Inventario y Consumo):** Es el núcleo de la app. Sin productos, el resto no funciona.
2.  **Fase 4 (Equipo y Configuración):** Para asegurar que la gestión multi-usuario funciona correctamente desde el principio.
3.  **Fase 2 (Lista y Supermercado):** Cierra el ciclo básico de uso manual.
4.  **Fase 3 (IA - Captura, Boletas, Chequeo):** Añade el valor diferencial una vez que la base es sólida.
5.  **Fase 4 (Historial):** Para auditoría una vez que hay datos fluyendo.