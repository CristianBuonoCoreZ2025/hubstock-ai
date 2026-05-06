# PROJECT_CONTEXT.md

# HUB-STOCK-AI

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

El sistema administra inventario doméstico por perfil.

Un perfil representa una casa, departamento, oficina o unidad de inventario.

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

## 2. Mundo del perfil

Es información propia de una casa o perfil.

Incluye:

- inventario del perfil
- secciones físicas del hogar
- consumo
- chequeos de stock
- compras
- responsables
- miembros del perfil

Este mundo sí representa stock real.

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

Representa perfiles o casas.

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

Representa categorías globales o comerciales.

Ejemplos:

- alimentos
- limpieza
- mascotas
- bebidas

No debe confundirse con secciones físicas de casa.

## sections

Representa lugares físicos del perfil.

Ejemplos:

- Baño
- Cocina
- Despensa
- Refrigerador principal
- Refrigerador externo
- Congeladora
- Patio
- Aseo
- Alimentos mascotas

Esta tabla debe usarse para ubicar productos dentro del hogar.

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

El inventario debe trabajar con sections.

Ejemplo:

Un producto global llamado Shampoo se encuentra en el perfil Casa Cristian, dentro de la sección Baño, con cierta cantidad disponible.

# Carga de inventario

La carga de inventario debe aceptar:

- carga por fotos
- carga por boleta
- carga manual

La carga manual existe, pero no es el flujo principal.

El flujo principal es visual.

# Carga por fotos

El usuario selecciona una sección del perfil.

Ejemplo:

Baño.

Luego sube una o varias fotos.

La IA analiza las imágenes.

El sistema debe:

- detectar productos
- buscar coincidencias en catalog_products
- mostrar alternativas cercanas
- permitir seleccionar producto correcto
- permitir crear producto si no existe
- registrar cantidad
- registrar sección
- registrar profile_id
- guardar movimiento en stock_movements

No debe guardar directo sin revisión del usuario.

No debe trabajar solo uno a uno.

Debe aceptar lote de fotos.

# Carga por boleta

La IA lee la boleta.

Por cada producto detectado debe:

- buscar producto global
- revisar alias
- revisar historial del perfil
- sugerir sección usada antes
- permitir corregir sección
- permitir confirmar producto
- permitir crear producto nuevo si no existe
- guardar items de boleta
- registrar movimiento de stock al confirmar

Ejemplo:

Si antes un producto se cargó en Baño, la siguiente boleta debe sugerir Baño.

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

# Consumo

Consumo es el flujo para descontar productos usados.

El usuario entra a una sección del perfil.

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

El usuario selecciona una sección.

Ejemplo:

Baño.

Luego sube fotos.

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

# Administración

Administración solo debe ser visible para administradores.

Debe manejar:

- perfiles
- miembros
- invitaciones
- permisos
- responsables
- configuración avanzada

Un usuario común no debe administrar perfiles ni personas.

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

# Reglas sobre perfil activo

Todo módulo operativo debe usar profile_id.

Módulos operativos:

- inventario
- consumo
- chequeo de stock
- compras
- dashboard

El catálogo global no depende de un perfil para existir.

# Reglas sobre categorías y secciones

categories representa clasificación global o comercial.

sections representa ubicación física dentro del perfil.

No mezclar ambos conceptos.

Ejemplo correcto:

Producto global: Shampoo.
Categoría global: higiene personal.
Sección del perfil: Baño.
Perfil: Casa Cristian.

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

- Perfiles
- Personas
- Invitaciones enviadas

## Perfiles

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