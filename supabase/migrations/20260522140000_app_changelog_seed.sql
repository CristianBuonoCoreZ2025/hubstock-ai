-- Seed historico de app_changelog: registra cambios arquitectonicos recientes
-- BEVECOHO: La base guarda TODO.

insert into public.app_changelog (version, module, description, files_changed, author, tags) values
  ('1.0.1', 'scraping', 'Reparacion STOP en captura-cadenas-2: barridoApiPhase2Seal ahora propaga AbortSignal. Proteccion contra doble STOP. Reduccion de llamados duplicados.',
    array['src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx', 'src/app/actions/retail-scrapping.ts', 'src/app/api/retail-scrapping/phase2-seal/route.ts', 'src/lib/retail-scrapping-barrido-api.ts'],
    'devin', array['fix', 'stop', 'scraping']),

  ('1.0.2', 'diagnostico', 'Log de diagnostico global activable desde Configuracion. Sanitizacion de datos sensibles. Auto-limpieza por navegacion. Panel global en AppShell.',
    array['src/lib/request-logger.ts', 'src/components/request-log-viewer.tsx', 'src/components/layout/AppShell.tsx', 'src/app/(app)/settings/DiagnosticLogToggle.tsx'],
    'devin', array['feature', 'diagnostico', 'log']),

  ('1.0.3', 'performance', 'Optimizacion carga inicial captura-cadenas-2: llamada combinada barridoApiInit que devuelve retails + runs en un solo request (~81% mas rapido).',
    array['src/app/api/retail-scrapping/init/route.ts', 'src/app/actions/retail-scrapping.ts', 'src/types/retail-scrapping-barrido-api.ts', 'src/lib/retail-scrapping-barrido-api.ts', 'src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx'],
    'devin', array['performance', 'init', 'scraping']),

  ('1.0.4', 'diagnostico', 'Trazabilidad completa: sesiones por pagina, traceId, duplicados, lentos, errores. Traza frontend->backend->base en endpoints criticos.',
    array['src/lib/request-logger.ts', 'src/components/request-log-viewer.tsx', 'src/components/layout/AppShell.tsx', 'src/lib/retail-scrapping-barrido-api.ts', 'src/app/api/retail-scrapping/init/route.ts', 'src/app/api/retail-scrapping/stop/route.ts', 'src/app/api/retail-scrapping/process-run-page/route.ts'],
    'devin', array['feature', 'trazabilidad', 'diagnostico']),

  ('1.0.5', 'diagnostico', 'Interceptor global de fetch para trazabilidad en toda la app. Captura automatica de todas las llamadas HTTP en todas las paginas.',
    array['src/lib/request-logger.ts', 'src/components/layout/AppShell.tsx'],
    'devin', array['feature', 'fetch-interceptor', 'diagnostico']),

  ('1.0.6', 'instrumentacion', 'Instrumentacion de paginas principales (catalogo, inventario, consumo) y helper server-side withServerActionDiagnostic.',
    array['src/app/(app)/catalog/CatalogTabs.tsx', 'src/app/(app)/inventory/InventoryView.tsx', 'src/app/(app)/consumption/ConsumptionView.tsx', 'src/app/actions/catalog.ts', 'src/lib/server-action-diagnostic.ts', 'src/lib/request-logger.ts'],
    'devin', array['feature', 'instrumentacion', 'diagnostico']),

  ('1.0.7', 'homologacion', 'Motor de homologacion paso 2: empty catalog guard para evitar ~35,600 busquedas de similitud innecesarias cuando catalog_products esta vacio.',
    array['supabase/migrations/20260701210000_homologation_step2_empty_catalog_guard.sql'],
    'devin', array['fix', 'performance', 'homologacion']),

  ('1.0.8', 'homologacion', 'Creacion de productos nuevos desde scrapping via RPC atomico en Postgres. Reemplaza batches de 1,000 filas por funcion SQL unica. Mapeo de taxonomia Lider.',
    array['supabase/migrations/20260702000000_scrapping_create_new_products_all.sql', 'src/server/retail/scrapping/scrapping-homologation-create-new.ts'],
    'devin', array['feature', 'rpc', 'homologacion', 'postgres']),

  ('1.0.9', 'homologacion', 'Fix: evita duplicados por URL dentro del lote de pending_new. Si dos filas de scrapping comparten la misma URL, apuntan al mismo producto maestro.',
    array['supabase/migrations/20260522134847_fix_create_new_products_duplicate_url.sql', 'src/app/(app)/captura-cadenas-2/create-new-products-modal.tsx', 'src/lib/request-logger.ts'],
    'devin', array['fix', 'duplicados', 'homologacion', 'sql']),

  ('1.0.10', 'versiones', 'Panel de versiones en Configuracion con historial de cambios tecnicos desde app_changelog. Registro estructurado de mejoras arquitectonicas.',
    array['src/app/(app)/settings/page.tsx', 'src/app/actions/changelog.ts', 'src/app/(app)/settings/ChangelogPanel.tsx', 'supabase/migrations/20260522140000_app_changelog_seed.sql'],
    'devin', array['feature', 'versiones', 'ui', 'auditoria']);
