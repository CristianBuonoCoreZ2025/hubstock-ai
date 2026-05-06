# IMPLEMENTATION_PLAN.md

# Plan controlado de implementación HUB-STOCK-AI

Este archivo no es para ejecución nocturna automática.

Este plan se ejecuta por etapas.

Cursor debe completar una etapa, validar, actualizar PROJECT_STATUS.md y detenerse.

El usuario revisa el resultado antes de avanzar a la siguiente etapa.

## Reglas generales

La base existente manda.

Primero mapear.
Luego adaptar.
Nunca duplicar.
Nunca destruir.

No crear tablas duplicadas.

No borrar tablas.

No borrar columnas.

No modificar RLS sin diagnóstico.

No ejecutar migraciones contra producción.

No usar mocks como solución final.

No avanzar de etapa sin dejar reporte.

## Validaciones al terminar cada etapa

Ejecutar si existen:

npm run lint
npm run build

Si no existe npm run typecheck, indicar que Next.js valida tipos dentro del build.

## Reporte obligatorio

Al terminar cada etapa, actualizar PROJECT_STATUS.md con:

1. Etapa ejecutada.
2. Archivos modificados.
3. Rutas modificadas.
4. Tablas involucradas.
5. Cambios realizados.
6. Validaciones ejecutadas.
7. Errores pendientes.
8. Riesgos.
9. Recomendación para la siguiente etapa.