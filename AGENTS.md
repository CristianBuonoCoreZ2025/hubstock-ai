# Registro de sesiones - HUB-STOCK-AI

## 2026-05-20 - Reparacion STOP scraping + Log de diagnostico global

### Objetivo principal
1. Reparar STOP en captura-cadenas-2 para que no quede pegado en "deteniendo".
2. Reutilizar el log existente de captura-cadenas-2 como herramienta global activable desde Configuracion.
3. Reducir llamados duplicados y lentitud en captura-cadenas-2 con cambios de bajo riesgo.

### Causa raiz del STOP pegado
`barridoApiPhase2Seal` (fase 2: descubrimiento completo del catalogo) no recibia senal de aborto. Cuando el usuario presionaba STOP, los workers de pagina del frontend se cancelaban, pero `phase2Promise` seguia corriendo en el servidor (puede tardar minutos). `executeBarridoWithPrepared` quedaba esperando `Promise.all([phase2Promise, ...workers])`, manteniendo el proceso activo en background y nunca terminando.

### Archivos modificados
- `src/lib/request-logger.ts`
- `src/components/request-log-viewer.tsx`
- `src/components/layout/AppShell.tsx`
- `src/app/(app)/settings/page.tsx`
- `src/app/(app)/settings/DiagnosticLogToggle.tsx` (nuevo)
- `src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx`
- `src/app/actions/retail-scrapping.ts`
- `src/app/api/retail-scrapping/phase2-seal/route.ts`
- `src/lib/retail-scrapping-barrido-api.ts`

### Cambios aplicados

**STOP controlado:**
- `barridoApiPhase2Seal` ahora acepta `signal?: AbortSignal` y lo propaga al `fetch`.
- En el cliente, `phase2Promise` se invoca con `sync.abortController.signal` y se envuelve con `.catch(...)` para que `Promise.all` no rompa si se aborta.
- El route handler `/api/retail-scrapping/phase2-seal` captura `request.signal` y lo pasa a la server action.
- `discoverPhase2AppendAndSealLiderScrappingPagesAction` acepta `abortSignal` en su input y verifica `aborted` antes de operaciones largas (`buildLiderFullCatalogPageSeeds` e `insertScrappingPageRows`).
- `processLiderScrappingRunPageAction` verifica `abortSignal` antes de `resetStaleScrappingPagesProcessing` y al inicio del `try` de captura de pagina.

**Proteccion contra doble STOP:**
- Agregado `stopInFlightRef = useRef(false)` en `CapturaCadenas2Client.tsx`.
- Guarda reforzada: `if (!canStopScrapping || stopBusy || stopInFlightRef.current) return`.
- Log en cliente: `console.info('[STOP] Solicitud de detencion', { runId, previousStatus })`.

**Lentitud - count(*) intermedio:**
- Eliminado `selectScrappingRowCountForRun` (un `count(*)`) del camino intermedio de cada pagina procesada.
- Ahora solo se cuenta al final (`waveDone`). Para paginas intermedias se usa `Number(run.rows_inserted ?? 0)`.

**Reduccion de llamados duplicados:**
- `reloadRuns()` ahora retorna `ScrappingRunRow[]` para reusar resultado.
- En `finally` del barrido: eliminado `reloadRetails()` innecesario y eliminado `barridoApiListRuns()` directo duplicado.
- Eliminado `requestLogger.clear()` del mount de captura-cadenas-2 (el log es global).

**Log de diagnostico global:**
- `requestLogger` ahora lee `enabled` desde `localStorage` (`stockcasa-diag-log-enabled`) al inicializar.
- Agregados `getEnabled()`, `setEnabled()`, `subscribeEnabled()`.
- `maxLogs` reducido de 1000 a 300.
- Agregada sanitizacion de datos sensibles (`Authorization`, `X-Api-Key`, `token`, `password`, `secret`, `service_role`, etc.).
- Agregado truncamiento de bodies > 5000 caracteres.
- Agregado `pathname` automatico a cada entrada.
- Eliminado `console.log` automatico de cada evento.
- `RequestLogViewer` se movio de captura-cadenas-2 a `AppShell.tsx` (layout global).
- Panel muestra `pathname` en cada entrada. Titulo cambiado a "Log de diagnostico".
- Toggle agregado en Configuracion (`/settings`) para activar/desactivar.

### Datos que registra el log
- type: `api`, `db`, `click`, `error`, `ui`
- action: nombre del evento/endpoint
- timestamp: ISO
- pathname: ruta actual del navegador
- duration: en ms
- status: `pending`, `success`, `error`
- request/response: sanitizados y truncados
- error: mensaje de error
- metadata: objeto extra

### Validacion
- `npm run build`: exitoso (solo warning preexistente de Turbopack).
- `npm run lint`: errores y warnings pre-existentes en archivos fuera del flujo de scraping. Ningun error nuevo en archivos modificados.

### Riesgos pendientes
1. `buildLiderFullCatalogPageSeeds` no recibe `AbortSignal` durante sus fetches internos. El `checkAborted` corta antes y despues, pero no durante el fetch HTTP. Impacto maximo: ~14s de timeout interno.
2. El frontend sigue coordinando workers paralelos (diseño intencional para serverless). Migrar a backend job requiere planificacion arquitectonica separada.
3. `reloadRuns()` aun se llama multiples veces durante un barrido (inicio, fase1, error, finally). Reducirlo a inicio+final seria la siguiente optimizacion segura.

---

## 2026-05-20 (continuacion) - Optimizacion carga inicial captura-cadenas-2

### Objetivo
Reducir el tiempo de carga inicial de `captura-cadenas-2`, que tardaba ~7.9s por el "serverless tax" doble de `listRetails` (~3.2s) + `listRuns` (~4.7s).

### Causa raiz
Cada llamada a una server action independiente paga el costo completo de: sesion + getProfileContext + requireCatalogEditorRetail + creacion de cliente admin. Con dos llamadas HTTP separadas al montar, el costo se duplicaba.

### Solucion aplicada
Crear una **llamada combinada** `barridoApiInit` que devuelve `retails + runs` en una sola server action, ejecutando ambas RPCs en paralelo con `Promise.all`.

### Archivos nuevos/modificados
- `src/app/api/retail-scrapping/init/route.ts` (nuevo)
- `src/app/actions/retail-scrapping.ts` (nueva `getScrappingInitAction`)
- `src/types/retail-scrapping-barrido-api.ts` (tipo `BarridoInitResponse`)
- `src/lib/retail-scrapping-barrido-api.ts` (helper `barridoApiInit`)
- `src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx` (mount usa `reloadInit`)

### Resultado
- **Antes:** ~7.9s (3.2s + 4.7s)
- **Despues:** ~1.5s (una sola llamada combinada)
- **Mejora:** ~81% mas rapido en la carga inicial de la pagina.

---

## 2026-05-20 (continuacion) - Trazabilidad completa: sesiones por pagina, frontend-backend-base

### Objetivo
Extender el log de diagnostico global para que funcione como un F12 interno enfocado en nuestros metodos, endpoints y flujos: sesion por ruta, traceId, duplicados, lentos, errores, traza frontend->backend->base.

### Cambios aplicados

**1. Sesion de diagnostico por ruta (`request-logger.ts`):**
- Nueva interfaz `LogSession` con: route, timestamps, contadores de eventos/metodos/api/db/errores/lentos/duplicados.
- `startPageSession(route)`: limpia logs previos, crea nueva sesion, registra `page_enter`.
- `endPageSession()`: registra `page_leave` con resumen de la sesion.
- `traceMethod` / `traceAsyncMethod`: wrappers para trazar funciones sincronas y asincronas.
- `createTraceId` / `getSessionTraceId`: generacion de traceId por sesion.
- Duplicados: `sessionCallMap` cuenta llamadas por accion; marca `isDuplicate` y `sessionCallCount`.
- `exportSessionToJSON()`: exporta sesion actual con estructura: session, summary, events, methodMap, apiMap, dbMap.
- `startLog` y `endLog` actualizan contadores de sesion automaticamente.

**2. Panel de diagnostico (`request-log-viewer.tsx`):**
- Tabs de vista: Cronologico, Metodos, Duplicados, Lentos, Errores.
- Resumen de sesion visible: route, eventos, errores, lentos, duplicados.
- Descarga nombrada por ruta: `diagnostic-log__ruta__fecha.json`.
- Nuevos tipos de evento soportados: `method`, `page`, `modal`, `poll`.
- Badge de duplicado en cada entrada con conteo.

**3. Auto-limpieza por navegacion (`AppShell.tsx`):**
- `useEffect` en `pathname` cambio: llama `startPageSession` al entrar, `endPageSession` al salir.
- Cada pagina inicia sesion limpia automaticamente.

**4. Instrumentacion frontend->backend (`retail-scrapping-barrido-api.ts`):**
- `getJson` y `postJson` ahora auto-loguean cada llamada con `startLog/endLog`.
- Propagan `parentTraceId` (sessionTraceId) para conectar la cadena.
- Envian header `x-app-diagnostic-log: 1` cuando el log esta activo.

**5. Traza backend->base (route handlers criticos):**
- `/api/retail-scrapping/init`: detecta header, mide duracion de `getScrappingInitAction`, incluye `__diagnostic` en respuesta.
- `/api/retail-scrapping/stop`: detecta header, mide duracion de `stopLiderScrappingAction`, incluye `__diagnostic`.
- `/api/retail-scrapping/process-run-page`: detecta header, mide duracion de `processLiderScrappingRunPageAction`, incluye `__diagnostic`.
- Sanitizacion: no se expone SQL, secrets ni datos sensibles.

**6. Captura-cadenas-2:**
- `executeBarridoWithPrepared` ya tenia `startLog('api', 'executeBarrido')` previo.
- `onDetenerScrapping` ya loguea `barridoApiStop`.
- `reloadInit` ya loguea `barridoApiInit`.
- BarridoApi ahora auto-loguea TODOS los calls de la pagina.

### Archivos modificados
- `src/lib/request-logger.ts`
- `src/components/request-log-viewer.tsx`
- `src/components/layout/AppShell.tsx`
- `src/lib/retail-scrapping-barrido-api.ts`
- `src/app/api/retail-scrapping/init/route.ts`
- `src/app/api/retail-scrapping/stop/route.ts`
- `src/app/api/retail-scrapping/process-run-page/route.ts`

### Validacion
- `npm run build`: exitoso.
- `npm run lint`: sin errores nuevos en archivos modificados.

### Recomendaciones pendientes
- Instrumentar `traceAsyncMethod` en metodos clave de otras paginas (dashboard, catalogo, inventario) usando los mismos helpers.
- Crear wrapper server-side central de Supabase para trazar DB operations automaticamente (hoy solo se trazan via `__diagnostic` en endpoints criticos).
- Reducir `reloadRuns()` a solo inicio y final del barrido.
- Migrar coordinacion de workers a un backend job/queue (Inngest, Vercel Cron, etc.).

### Recomendaciones no aplicadas (riesgo mayor)
- Reducir `reloadRuns()` a solo inicio y final del barrido.
- Usar `run.rows_inserted` como proxy durante todo el procesamiento, eliminando incluso el `count(*)` residual del `waveDone`.
- Migrar coordinacion de workers a un backend job/queue (Inngest, Vercel Cron, etc.).
