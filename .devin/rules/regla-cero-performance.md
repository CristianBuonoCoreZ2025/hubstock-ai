# Regla Cero: Performance y Logging

## Regla INNEGOTIABLE

Toda página debe ser fluida. Antes de declarar una página como "lista", se debe activar el sistema de request logging y pasar esta checklist.

---

## Checklist Obligatorio

### 1. No llamadas duplicadas
- Cada consulta a la base/API debe ejecutarse **UNA sola vez** al cargar
- Si hay 2+ llamadas idénticas en menos de 2 segundos → **BUG**
- Usar guardas de tiempo o `initializedRef` para prevenir duplicados

### 2. Tiempo máximo: 2 segundos
- Ninguna operación debe demorar más de 2 segundos
- Si tarda más: agregar timeout o optimizar (índices, queries, etc.)

### 3. Log de cada consulta
- Todo clic, toda llamada API, toda respuesta debe quedar registrada
- Timestamp + duración en ms + request + response

### 4. Log se limpia al entrar
- Al cargar la página, el log anterior se borra automáticamente
- Se ve solo lo que pasa en esta sesión

### 5. Errores reales visibles
- Los errores deben mostrar el mensaje REAL de la base de datos
- Nada de "Hubo un error" genérico

---

## Proceso por Página

1. **Activar** `RequestLogViewer` en la página
2. **Revisar** que no haya llamadas duplicadas en el log
3. **Corregir** hasta que la carga inicial sea < 2 segundos total
4. **Desactivar** el log viewer cuando la página pase revisión
5. **Pasar** a la siguiente página

---

## Archivos del Sistema

| Archivo | Propósito |
|---------|-----------|
| `src/lib/request-logger.ts` | Logger con timestamps |
| `src/components/request-log-viewer.tsx` | Panel visual en tiempo real |

## Uso en una página

```tsx
import { requestLogger, withLogging } from '@/lib/request-logger'
import { RequestLogViewer } from '@/components/request-log-viewer'

// En useEffect de montaje:
requestLogger.clear() // Limpiar log anterior

// En cada llamada API:
const res = await withLogging('api', 'nombreAccion', () => miApiCall())

// Al final del JSX:
<RequestLogViewer />
```

---

## Ejemplos de problemas comunes

### ❌ PROHIBIDO: Llamadas duplicadas
```
getScrappingHomologationDashboardAction  1500ms
getScrappingHomologationDashboardAction  1400ms  <-- DUPLICADO
```

### ❌ PROHIBIDO: Errores genéricos
```
{ ok: false, error: "Hubo un error" }  <-- NO
{ ok: false, error: "DB Error: column sr.created_at does not exist" }  <-- SÍ
```

### ❌ PROHIBIDO: Tiempo > 2 segundos
```
barridoApiListRuns  4500ms  <-- DEMASIADO LENTO
```

---

**Esta regla aplica a TODAS las páginas sin excepción.**
