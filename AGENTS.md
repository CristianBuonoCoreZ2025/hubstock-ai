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

### Recomendaciones no aplicadas (riesgo mayor)
- Reducir `reloadRuns()` a solo inicio y final del barrido.
- Usar `run.rows_inserted` como proxy durante todo el procesamiento, eliminando incluso el `count(*)` residual del `waveDone`.
- Migrar coordinacion de workers a un backend job/queue (Inngest, Vercel Cron, etc.).
