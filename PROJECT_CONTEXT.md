# PROJECT_CONTEXT.md

# HUB-STOCK-AI

Este proyecto trabaja bajo la regla UX primero. Toda pantalla debe ser clara, rápida, consistente y entendible antes de considerarse terminada. Antes de cambiar UX o pantallas, leer **por completo** `.cursor/rules/01_ux_primero.mdc` (incluye estándar de búsqueda: Enter + lupa **dentro** de la caja de texto). El contrato de UI común (consultas &lt; 1 s, paginación arriba y abajo, botones de ancho uniforme, acciones de fila solo ícono + tooltip, combobox inteligente) está en `.cursor/rules/ui-product-rules.mdc` con refuerzo en `.cursor/rules/data-grid-performance-rules.mdc`.


Este proyecto es una aplicación de inventario doméstico con IA.

La aplicación ya tiene base de datos Supabase creada y operando.

No se debe crear una arquitectura desde cero.

No se deben crear tablas duplicadas.

No se deben borrar tablas, columnas, relaciones ni políticas RLS.

La regla principal del proyecto es:

La base existente manda.
Primero se debe mapear.
Luego se debe adaptar.
Nunca duplicar.
Nunca destruir.

# Stack del proyecto

El proyecto usa:

- Next.js
- TypeScript
- Supabase
- Tailwind
- Componentes UI existentes del proyecto
- Base de datos Supabase ya creada

Cursor debe revisar el stack real antes de modificar.

# Objetivo del sistema

El sistema administra inventario doméstico por **ubicación** (entidad `profiles` en base de datos; `profile_id` en todas las tablas operativas).

En la interfaz de usuario el hogar o unidad de inventario se denomina **«Ubicación»** (antes «Perfil» en varios textos). La tabla y la columna siguen llamándose `profiles` / `profile_id`; no se renombraron en la base.

Una ubicación representa una casa, departamento, oficina o unidad de inventario.

Ejemplos:

- Casa Cristian
- Departamento
- Oficina
- Casa familiar

Todo dato operativo debe estar asociado a un profile_id.

# Concepto central

El sistema tiene dos mundos distintos:

## 1. Mundo global

Es información común para todos los perfiles.

Incluye:

- catálogo global de productos
- marcas
- categorías globales
- productos de supermercado
- alias de productos
- imágenes de productos
- datos para búsqueda y relación

Este mundo no representa stock personal.

## 2. Mundo del perfil (ubicación activa)

Es información propia de una casa o **ubicación** (`profiles`).

Incluye:

- inventario del perfil
- zonas físicas del hogar (lista fija compartida; ver más abajo)
- consumo
- chequeos de stock
- compras
- responsables
- miembros del perfil

Este mundo sí representa stock real.

# Regla clave: dos “clasificaciones” distintas en el producto del perfil

En el sistema conviven dos ejes que el usuario suele llamar “categorías”, pero no cumplen el mismo rol:

## 1) Taxonomía global del catálogo (sección/categoría comercial)

Estas tablas son **globales** (compartidas por todos los perfiles):

- **`sections`**: “pasillo / rubro” comercial (ej. alimentos, limpieza, mascotas).
- **`categories`**: subcategoría dentro de una `section`.

Se usan para **navegar y normalizar** el catálogo global y también para clasificar los productos del perfil (porque `products` referencia `section_id` y `category_id`).

## 2) Zona física del hogar (no es la taxonomía del catálogo)

Para “dónde está en la casa” se usa un conjunto **fijo de zonas** (misma lista para todas las ubicaciones): alacena, refrigerador, congelador, baño/aseo, bodega, otro. Están definidas en código (`src/lib/stock-zones.ts`, `STOCK_ZONE_OPTIONS`) y son las mismas en **Chequeo de stock** (`stock_checks.zone`) y en **Carga por fotos** (se guardan en `products.location` como texto con el mismo valor canónico).

Los catálogos auxiliares del perfil (`profile_product_types`, `profile_presentations`, etc.) son independientes de estas zonas.

Regla: **no** confundir `sections` / `categories` (rubro comercial global en catálogo) con **zona física** (alacena, nevera, etc.).

# Tablas existentes visibles

La base ya tiene estas tablas visibles y deben respetarse:

- catalog_brands
- catalog_product_aliases
- catalog_product_media
- catalog_products
- categories
- invitation_targets
- invitations
- product_images
- products
- profile_brands
- profile_members
- profile_presentations
- profile_product_types
- profiles
- purchase_receipt_items
- purchase_receipts
- sections
- shopping_trip_items
- shopping_trips
- stock_check_detected_items
- stock_check_photos
- stock_checks
- stock_measure_units
- stock_movements
- stock_net_content_options

Antes de crear cualquier tabla nueva, Cursor debe revisar si una tabla existente ya cumple esa función.

# Mapeo funcional inicial de tablas

## profiles

Representa una **ubicación** (hogar o unidad de inventario). En UI suele etiquetarse «Ubicación»; en SQL sigue siendo `profiles`.

Ejemplo:

- Casa Cristian
- Departamento
- Oficina

Todo inventario, consumo, chequeo y compra debe operar sobre un profile_id.

## profile_members

Representa personas asociadas a un perfil.

Sirve para:

- miembros del hogar
- responsables de compra
- permisos por perfil
- acceso al perfil

## catalog_products

Representa el catálogo maestro de productos.

Es global.

No representa stock personal.

Debe usarse para buscar, relacionar y normalizar productos.

## catalog_brands

Representa marcas del catálogo.

Las marcas se alimentan desde productos y desde cargas de compra.

## profile_brands

Representa marcas relacionadas al perfil.

Si ya existe esta tabla, Cursor debe revisar su uso antes de crear otra.

## catalog_product_aliases

Representa nombres alternativos de productos.

Sirve para:

- boletas
- nombres detectados por IA
- errores de lectura
- equivalencias
- búsquedas tolerantes

## catalog_product_media y product_images

Representan imágenes o medios de productos.

Cursor debe revisar la diferencia real entre ambas antes de modificar.

## categories

Representa categorías globales o comerciales (dependen de `sections`).

Ejemplos:

- alimentos
- limpieza
- mascotas
- bebidas

No debe confundirse con secciones físicas de casa.

## sections

Representa secciones globales o comerciales (taxonomía del catálogo).

## profile_product_types

Representa tipos de producto por perfil si ya está implementado así.

Cursor debe revisar el uso real antes de modificar.

## purchase_receipts

Representa boletas o compras capturadas.

## purchase_receipt_items

Representa productos detectados dentro de una boleta.

## stock_movements

Representa la bitácora central del stock.

Todo aumento, descuento o ajuste de stock debe pasar por stock_movements.

No se debe actualizar stock sin registrar movimiento.

## stock_checks

Representa chequeos de stock.

## stock_check_photos

Representa fotos asociadas a un chequeo de stock.

## stock_check_detected_items

Representa productos detectados por IA en un chequeo de stock.

## shopping_trips

Representa compras planificadas o viajes de compra.

Debe usarse para listas asociadas a tienda, fecha y responsable si el modelo actual lo permite.

## shopping_trip_items

Representa productos incluidos en una compra planificada.

# Módulos correctos del sistema

El menú funcional correcto debe ser:

1. Dashboard
2. Catálogo
3. Inventario
4. Consumo
5. Chequeo de stock
6. Compras
7. Administración
8. Configuración

# Dashboard

El Dashboard es la primera vista del usuario.

Debe mostrar información ejecutiva del perfil activo.

Debe mostrar:

- resumen de stock
- productos con bajo stock
- últimos movimientos
- últimas cargas de inventario
- últimos consumos
- últimas boletas
- últimos chequeos
- próximas compras programadas
- accesos rápidos

El Dashboard no debe ser una lista infinita.

Debe ser una vista de impacto inicial.

# Catálogo

El catálogo no es el inventario.

El catálogo es la base global de productos.

Debe permitir:

- buscar productos
- navegar por categorías
- crear productos nuevos
- editar productos existentes
- asociar marcas
- asociar imágenes
- administrar alias
- mantener datos normalizados

Regla clave:

Si un producto no existe y se detecta desde foto o boleta, el sistema debe ofrecer crearlo en el catálogo global.

El catálogo global alimenta inventario, boletas, IA y compras.

# Productos de supermercado

Los productos de supermercado son globales.

Son usados por todos los perfiles.

Deben mantenerse normalizados.

Sirven para:

- búsqueda
- comparación
- relación con boletas
- relación con productos detectados por IA
- carga de inventario

No deben mezclarse con stock real del usuario.

# Inventario

El inventario pertenece a un profile_id.

El inventario usa productos globales, pero el stock pertenece al perfil.

## Vínculo catálogo → inventario (obligatorio en el flujo manual)

Un ítem de inventario (`products`) **no es un producto nuevo**: es una instancia en el hogar que **siempre** debe referenciar un producto maestro en `catalog_products` mediante `products.catalog_product_id`. El **nombre** del ítem en inventario lo define el catálogo (no hay alta con nombre libre desde el modal de inventario).

- Si falta el maestro en el catálogo, el usuario debe **crearlo en Catálogo** y luego agregarlo al inventario.
- Datos heredados del maestro: emparejamiento en boletas/captura, alias, consistencia de nombres.

Ítems antiguos **sin** `catalog_product_id` deben **enlazarse** a un producto del catálogo al editar (no guardar sin vínculo).

## Pantalla `/inventory` (implementado)

- **Alta**: modal **“Agregar desde catálogo”** — dos caminos: (1) **elegir** un producto maestro ya existente (`catalog_products`); (2) si **no existe** en catálogo, **crear nombre estándar** en una sola acción: inserta el maestro en `catalog_products` y el ítem en `products` del perfil (mismo nombre; requiere rol editor, igual que escritura de catálogo). Luego sección/categoría comercial y cantidades. Enlace a **Catálogo** para administrar solo el maestro.
- **Edición**: si ya hay vínculo, el nombre se muestra como referencia al catálogo (solo se ajustan clasificación y stock). Sin vínculo (legado): obligatorio elegir producto del catálogo antes de guardar.
- **Grilla paginada en servidor**: tamaño de página **100**; controles **Anterior / Siguiente** y conteo total.
- **Mostrar inactivos**: switch visible; por defecto **apagado**; el filtro `active` aplica en la consulta (no se cargan inactivos si está apagado).
- **Filtros** por sección y categoría (taxonomía global `sections` / `categories` del producto `products`) vía query string.
- **Búsqueda**: prefiltro server-side por nombre cuando hay texto (≥2 caracteres); refinamiento **tipo Google** en cliente sobre el lote usando `src/lib/search.ts` (`filterBySearch` / `matchesSearch`).
- **Catálogo**: buscador remoto en el modal (≥2 caracteres, debounce, máximo 50 resultados) vía `searchCatalogProductsForPickerAction`; la grilla indica si el ítem está **vinculado** al catálogo.
- **Errores** en acciones de inventario: mensajes vía `getUserFriendlyErrorMessage` (sin textos técnicos crudos al usuario).

Ejemplo:

Un producto global llamado Shampoo se encuentra en el perfil Casa Cristian, clasificado en la taxonomía global del catálogo (sección/categoría del `products` del perfil), con cierta cantidad disponible.

# Carga de inventario

La carga de inventario debe aceptar:

- carga por fotos
- carga por boleta
- carga manual

La carga manual existe, pero no es el flujo principal.

El flujo principal es visual.

Regla de UX:

- En **carga por fotos**, el usuario elige **modelo IA**, **zona física** y **foto** antes de analizar; la clasificación comercial es **por ítem** (catálogo global). En otros flujos (boleta, manual) aplican las reglas de cada pantalla.
- La IA **propone** y el usuario **confirma** antes de impactar el stock.

# Carga por fotos (`/capture`)

Flujo alineado con **Chequeo de stock** en el orden de controles:

1. Modelos OpenRouter (gratis primero / solo gratis / solo de pago).
2. **Zona física** del hogar (lista fija `STOCK_ZONE_OPTIONS`; equivalente semántico a la zona del chequeo).
3. Foto y **Analizar**.

Por cada producto detectado:

- **Sección y categoría** provienen de la **taxonomía global del catálogo** (`sections` / `categories`): se propone una categoría a partir del texto sugerido por la IA (`categoryGuess`) con coincidencia tolerante (`pickCatalogTaxonomyFromGuess` en `src/lib/catalog-taxonomy-match.ts`); el usuario puede corregir **por fila** en un selector agrupado por sección comercial.
- La **zona** elegida en el paso 2 se persiste en **`products.location`** (mismo valor canónico que `stock_checks.zone`, p. ej. `alacena`, `refrigerador`).
- Enriquecimiento opcional con Open Food Facts sigue siendo independiente del catálogo interno.

La revisión es obligatoria antes de guardar; el stock inicial registra movimiento `import` en `stock_movements` cuando corresponde (ver implementación en `addProductFromCapture`).

La pantalla puede listar **varios productos en una misma foto** (varias filas en tabla compacta).

**Pendientes de producto / catálogo:** búsqueda explícita de coincidencias en `catalog_products` fila a fila y alta controlada de maestro desde captura pueden ampliarse sin cambiar la regla de confirmación previa al stock.

# Carga por boleta

La IA lee la boleta.

Por cada producto detectado debe:

- buscar producto global
- revisar alias
- revisar historial del perfil
- sugerir sección usada antes para ese producto en ese perfil
- permitir corregir sección
- permitir confirmar producto
- permitir crear producto nuevo si no existe
- guardar items de boleta
- registrar movimiento de stock al confirmar

Ejemplo:

Si antes un producto se cargó en Baño, la siguiente boleta debe sugerir Baño.

Nota importante:

- La boleta puede no traer una sección explícita por línea. La sección sugerida debe salir de la **historia del perfil** (por ejemplo: última sección confirmada para ese producto en ese perfil) y siempre debe poder corregirse.

# Captura IA

Captura IA no debe ser un módulo aislado.

Debe formar parte del flujo de inventario.

Debe soportar:

- varias fotos
- boletas
- revisión previa
- relación con catálogo
- creación controlada de productos
- confirmación antes de stock

Si existe menú Captura IA, debe integrarse a Inventario.

Regla de lote:

- Captura IA debe soportar **subir muchas fotos de una sección en una sola sesión** y luego mostrar una revisión consolidada (no una confirmación 1:1 por foto como flujo principal).

# Consumo

Consumo es el flujo para descontar productos usados.

Consumo es siempre **sobre el inventario del perfil** (no es aleatorio).

El usuario entra a una sección/zona del perfil (ubicación del hogar) o filtra por su clasificación interna.

El sistema muestra productos con stock.

El usuario selecciona uno o varios productos.

El sistema descuenta unidades.

Debe registrar movimiento en stock_movements.

Consumo no debe crear productos.

Consumo no debe consumir productos inexistentes.

Consumo no debe descontar sin stock.

# Historial de consumo

El historial de consumo pertenece al módulo Consumo.

Debe mostrar:

- producto
- sección
- cantidad consumida
- fecha
- usuario
- perfil
- origen del descuento

Debe filtrar por:

- fecha
- producto
- sección
- perfil

# Chequeo de stock

Chequeo de stock es un módulo separado.

Sirve para validar si el stock físico coincide con el stock calculado.

Stock calculado significa:

Inventario cargado menos consumo registrado.

El usuario selecciona una **zona física** del hogar (misma lista que en carga por fotos; campo `stock_checks.zone`).

La IA detecta productos visibles.

El sistema compara:

- productos esperados
- productos encontrados
- productos faltantes
- productos sobrantes
- posibles relaciones incorrectas

Chequeo de stock no debe aplicar cambios directo.

Debe proponer ajustes.

El usuario confirma.

Si falta stock, el sistema registra consumo no declarado.

Si aparece stock no registrado, el sistema propone agregar inventario.

Si la IA relacionó mal un producto, el usuario debe corregir la relación.

Al confirmar ajustes, se deben crear movimientos en stock_movements.

# Compras

Compras se basa en el universo del perfil.

El universo del perfil incluye:

- inventario inicial
- stock actual
- consumo
- bajo stock
- historial de compras
- secciones del perfil

El usuario debe crear compras o listas distintas.

Ejemplos:

- alimentos animales
- verduras
- supermercado mensual
- limpieza
- farmacia
- mascotas

Las compras deben permitir:

- productos sugeridos
- productos manuales
- cantidad sugerida
- cantidad final
- prioridad
- estado
- tienda
- fecha de compra
- responsable

# Tiendas

Las tiendas representan lugares donde se compra.

Ejemplos:

- Lider
- Jumbo
- PetCompany
- Easy
- Unimarc
- verdulería local

Si no existe tabla específica de tiendas, Cursor debe revisar si shopping_trips ya cubre parte de esa función.

No debe crear tabla nueva sin diagnóstico.

Reglas:

- no repetir tienda por nombre normalizado
- permitir asociar compra a tienda
- permitir asociar fecha
- permitir asociar responsable
- mantener historial de compras planificadas

Regla de responsables:

- Los responsables salen de los **miembros del perfil** (`profile_members`) y se usan para asignar compras (planificación) y, a futuro, notificaciones.

# Administración

Administración solo debe ser visible para administradores.

Debe manejar:

- ubicaciones (`profiles` — alta desde «Ubicación» en menú)
- miembros
- invitaciones
- permisos
- responsables
- configuración avanzada

Un usuario común no debe administrar ubicaciones ni personas.

# Configuración

Configuración debe manejar preferencias del usuario o del perfil.

No debe mezclarse con Administración si son permisos distintos.

# Reglas críticas de stock

Todo stock debe nacer desde movimientos.

Todo aumento de stock debe registrar stock_movements.

Todo consumo debe registrar stock_movements.

Todo ajuste por chequeo debe registrar stock_movements.

No actualizar cantidades sin movimiento.

Si existe una tabla de stock acumulado, debe derivar o sincronizarse desde movimientos.

Cursor debe revisar la implementación real antes de cambiarla.

# Reglas sobre IA

La IA ayuda a detectar.

La IA no decide sola.

La IA debe proponer.

El usuario confirma.

Los resultados IA deben quedar en estado pendiente hasta revisión.

La IA debe guardar sugerencias, no cambios definitivos.

Los endpoints de visión **`/api/ai/analyze-product`**, **`/api/ai/analyze-receipt`** y **`/api/ai/stock-check`** comparten el modo **OpenRouter** (`openRouterTier`: gratis primero, solo gratis, solo de pago), coherente con la cadena de proveedores en servidor (`resolveStockCheckVisionChain`).

# Reglas sobre perfil activo

Todo módulo operativo debe usar profile_id.

Módulos operativos:

- inventario
- consumo
- chequeo de stock
- compras
- dashboard

El catálogo global no depende de un perfil para existir.

# Reglas sobre categorías, secciones y zonas

- **`categories` y `sections`**: taxonomía **global / comercial** del catálogo. Los productos del inventario (`products`) referencian `section_id` y `category_id` para clasificación de pasillo y compras.
- **Zona física** (alacena, refrigerador, etc.): no es `sections`; es la lista fija en `stock-zones` y valores en `stock_checks.zone` o `products.location`.

No mezclar taxonomía de catálogo con zona física del hogar.

Ejemplo correcto:

Producto en inventario: Shampoo (nombre ligado a `catalog_products` según reglas vigentes).
Categoría/sección **comercial** global: higiene personal / droguería (según datos en `categories` / `sections`).
Zona física del hogar: baño / alacena (campo de zona o `location`).
Ubicación (hogar): Casa Cristian (`profiles`).

# Reglas de navegación

El menú debe ser simple y ordenado.

Menú esperado:

- Dashboard
- Catálogo
- Inventario
- Consumo
- Chequeo de stock
- Compras
- Administración
- Configuración

No crear menús duplicados.

No esconder flujos importantes en páginas incorrectas.

No dejar Captura IA como flujo suelto si corresponde a Inventario.

# Reglas de implementación para Cursor

Antes de modificar código, Cursor debe:

- leer estructura de carpetas
- revisar rutas
- revisar menú
- revisar componentes
- revisar servicios
- revisar queries
- revisar tipos de Supabase
- revisar migraciones
- revisar uso de tablas
- revisar uso de stock_movements
- revisar permisos y RLS

Antes de crear tablas, debe responder:

- tabla equivalente existente
- motivo de nueva tabla
- columnas necesarias
- impacto en código
- impacto en RLS
- migración no destructiva

# Prohibiciones

No crear tablas duplicadas.

No borrar tablas.

No borrar columnas.

No cambiar RLS sin diagnóstico.

No cambiar stack.

No mover todo el proyecto sin plan.

No usar mocks como solución final.

No mezclar catálogo con inventario.

No mezclar categories con sections.

No guardar IA directo en stock.

No descontar stock sin movimiento.

No modificar producción directo.

# Forma de trabajo esperada

Cada tarea debe seguir este orden:

1. Diagnóstico.
2. Mapeo contra la base actual.
3. Brechas.
4. Plan por etapas.
5. Archivos a modificar.
6. Riesgos.
7. Cambios.
8. Validación.
9. Reporte.

# Comandos de validación

Cursor debe ejecutar si existen:

npm run lint
npm run typecheck
npm run build

Si un comando no existe, debe indicarlo en el reporte.

# Entrega esperada por cada cambio grande

Cursor debe entregar:

- archivos modificados
- tablas tocadas
- rutas tocadas
- componentes tocados
- migraciones creadas
- validaciones ejecutadas
- errores pendientes
- riesgos
- pasos para probar

# Administración

Administración solo debe estar visible para administradores.

Debe manejar:

- Ubicación (altas de `profiles`; etiqueta de menú «Ubicación»)
- Personas
- Invitaciones enviadas

## Ubicación (tabla `profiles`)

Representan casas o unidades de inventario.

Ejemplos:

- Casa Cristian
- Departamento
- Oficina

## Personas

Personas representa usuarios, miembros, responsables y accesos asociados a perfiles.

No debe existir una separación funcional entre Personas y Equipos.

Equipo es solo la agrupación de personas dentro de un perfil.

## Invitaciones enviadas

Invitaciones enviadas es una vista de consulta.

Sirve para revisar invitaciones ya enviadas.

No es un módulo central.

No debe confundirse con Personas.