# UPDATE — Trabajo en curso

> Fecha: 2026-05-18  
> Estado: **Build OK** (`npm run build` exit code 0)

---

## Tarea actual: Imágenes y Taxonomía Multi-Retail

### Hecho en esta sesión

1. **Imágenes — captura y persistencia**
   - `map-vtex-product.ts`: extrae `items[0].images[0].imageUrl` de la respuesta VTEX y lo expone en `RetailSnapshotRow.image_url`.
   - `retail-scrapping.ts` (`ScrappingUpsertRow`): agrega `image_url` al tipo y al mapping de filas que se upsertean en `scrapping`.
   - `scrapping-homologation-create-new.ts`: al crear el producto, lee `row.image_url` de la fila scrapping y lo pasa a `downloadAndUploadProductImage` antes de intentar inferirlo desde `product_url`.

2. **Taxonomía — fallback fuzzy para Jumbo/Central Mayorista**
   - `scrapping-similarity-taxonomy.ts`: para retailers != `lider`, en lugar de retornar `null`, llama a `resolveCategoryByFuzzyName` que carga todas las categorías del catálogo y busca por coincidencia normalizada (exacta → parcial) contra el `categories` y `sections` del producto scrapeado.
   - La caché `taxonomyCache` aplica también al resultado fuzzy para no repetir queries.

3. **UI dashboard — fix conteos**
   - `getScrappingHomologationDashboardAction` ya no usa `assertNoRunningScrappingForHomologation` (que bloqueaba la lectura con scrapping en curso); ahora solo requiere auth (`requireCatalogEditorRetail`).
   - Chips mejorados: `pending`, `gris IA`, `revisar` (resaltado si > 0), `nuevos` (verde si > 0).
   - Mensaje contextual cuando `pendingAny = 0` pero hay `userReview` o `pendingNew`.

4. **Phase 2 (Seal) generalizada para VTEX**
   - `@/app/actions/retail-scrapping.ts`: `discoverPhase2AppendAndSealLiderScrappingPagesAction` ahora detecta VTEX retailers (`isVtexRetailer`) y sella la cola sin descubrimiento adicional.
   - Líder conserva su lógica de expansión completa con `buildLiderFullCatalogPageSeeds`.

2. **Limpieza de imports**
   - Eliminados `captureLiderRetailPage`, `partitionLiderCaptureForCleanInsert`, `isLiderCatalogSystemSearchUrl`, `isLiderHtmlBrowseListingUrl`, `nextLiderCatalogSystemSliceUrl`, `nextLiderHtmlBrowseListingPageUrl`, `LiderPageSeed`, `VtexPageSeed` de `retail-scrapping.ts`.

3. **Corrección de tipado**
   - `retail-capture-adapter.ts` línea 128: `unit_price` forzado a `number` con `Number()`.

4. **Paso 3: Nuevos en catálogo — UI funcional**
   - `@/app/actions/retail-scrapping.ts`: `getScrappingHomologationDashboardAction` ahora devuelve `pendingNew` (conteo de `catalog_match_status = 'pending_new'`).
   - `@/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx`:
     - Import de `runScrappingHomologationCreateNewBatchAction`.
     - Estados `createNewBusy`, `createNewResult`.
     - Handler `handleCreateNewBatch` con loop de batches (tamaño 10) y progreso en tiempo real.
     - Botón reemplazado: muestra conteo `pendingNew`, estado de carga (`Loader2`), resultado final y se deshabilita cuando no hay pendientes o hay scrapping en curso.

5. **Documentación**
   - `README.md` actualizado con sección "Homologación — Paso 3".
   - Archivos `.md` obsoletos eliminados (`PROJECT_STATUS.md`, `PROJECT_CONTEXT.md`, `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, etc.).

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `src/app/actions/retail-scrapping.ts` | Phase 2 VTEX, `pendingNew` en dashboard, imports limpios |
| `src/server/retail/scrapping/retail-capture-adapter.ts` | Fix tipado `unit_price` |
| `src/app/(app)/captura-cadenas-2/CapturaCadenas2Client.tsx` | Botón Paso 3 funcional, handler, estados |
| `README.md` | Actualizado con mejoras recientes |

---

## Pendientes

1. **Prueba de integración real con Jumbo o Central Mayorista**
   - Crear una corrida de scrapping y verificar que Phase 1 encole URLs VTEX correctamente.
   - Verificar que la captura VTEX devuelve productos parseados correctamente.

2. **Revisar `scrapping-homologation-create-new.ts`**
   - Verificar que `source_system` sea genérico (ya está como `'scrapping_homologation'` ✅).
   - Verificar que la taxonomía funcione para Jumbo/Central Mayorista (las `sections`/`categories` vienen de VTEX y pueden necesitar mapeo).

3. **UI/UX — Mensajes amigables**
   - Validar que los errores del Paso 3 se muestren con `getUserFriendlyErrorMessage` (ya se usa en server action ✅).

4. **Monitorear OpenRouter API key rotation**
   - Bajo carga real, verificar que la rotación funciona cuando una key da rate limit.

5. **HomologationWizardModal estilo**
   - Si se requiere, aplicar el estándar visual del proyecto (step indicators, shimmer, stat badges, etc.) según memoria previa.

---

## Validación

```bash
npm run build      # ✅ Correcto (exit code 0, 34.1s compilación)
npx tsc --noEmit   # ✅ Sin errores
```

> **Nota:** El warning de Turbopack sobre `next.config.js` es preexistente (viene de `pdf-text.ts`) y no afecta la ejecución.

---

## Siguiente paso sugerido

Ejecutar una corrida de scrapping con Jumbo para validar el flujo completo: Phase 1 → Phase 2 → Procesamiento → Paso 3 (crear nuevos productos).
