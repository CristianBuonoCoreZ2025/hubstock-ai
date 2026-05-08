# Captura de precios por cadena (sin duplicar maestros)

## Idea central

- **`catalog_products`**: un solo registro por producto “canónico” (nombre de referencia global).
- **`catalog_retail_snapshots`**: cada corrida de import guarda **precio + fecha** por ítem de tienda (`retailer` + `external_ref`). No crea productos nuevos del catálogo.
- **`catalog_retail_links`**: tabla de **homologación**: “este ítem de Jumbo/Lider/Central Mayorista” = “este `catalog_product_id`”. Una fila por (`retailer`, `external_ref`) → un maestro.

La **comparativa inteligente** usa la RPC `catalog_retail_match_candidates` en Postgres (similitud de nombre con `pg_trgm`, cercanía de precio, categoría opcional). La app la usa en **Catálogo → Precios cadenas → Homologar**. El script puede usar la misma lógica con `--auto-match`.

## Flujo recomendado

### 1. Scraping local (fuera de este repo)

Tu scraper genera un SQLite con las mismas tablas que el import Lider (`categorias`, `subcategorias`, `productos`), por ejemplo:

- `lider/productos_lider.db`
- `jumbo/productos_jumbo.db`
- `central_mayorista/productos_central_mayorista.db`

Esas carpetas suelen estar en `.gitignore`; los datos no se suben al repositorio.

### 2. Import masivo Lider (solo si querés poblar el maestro desde Lider)

```bash
python scripts/import_lider_sqlite.py
```

Crea filas en `catalog_products` y deduplica por `source_product_url` cuando existe.

### 3. Capturas retail (solo snapshots + historial)

Por cada cadena, sin crear duplicados en el maestro:

```bash
python scripts/import_retail_snapshots.py --retailer jumbo
python scripts/import_retail_snapshots.py --retailer central_mayorista
python scripts/import_retail_snapshots.py --retailer lider --sqlite lider/productos_lider.db
```

### 4. Homologación (igualar ítem externo → maestro)

**Opción A — Manual (revisión humana)**  
**Catálogo → Precios cadenas**: filtros, **Homologar**, sugerencias ordenadas por puntaje, o búsqueda del maestro.

**Opción B — Automática al importar (umbral de confianza)**

```bash
python scripts/import_retail_snapshots.py --retailer jumbo --auto-match --auto-match-min-score 0.62
```

Usa la misma RPC que el modal **Homologar** (`catalog_retail_match_candidates`: nombre + precio + trigram). Solo crea `catalog_retail_links` si el mejor candidato supera el umbral. Si ya hay vínculo para ese `retailer` + `external_ref`, no lo cambia (respetá homologaciones manuales).

Si el umbral es muy bajo podés unir ítems incorrectos: subí `--auto-match-min-score` (p. ej. `0.72`) o homologá a mano los que queden en **Precios cadenas**.

### 5. Recapturas (historial de precios)

Volvé a ejecutar el mismo comando de snapshots cuando quieras actualizar precios: se inserta una **nueva** fila en `catalog_retail_snapshots`; el historial queda por fecha. Los vínculos en `catalog_retail_links` siguen apuntando al mismo maestro.

## Cómo evitar duplicados

| Riesgo | Mitigación |
|--------|------------|
| Dos maestros para el mismo producto | Unificar en catálogo (editar / alias) y homologar cada cadena al **mismo** `catalog_product_id`. |
| Import retail crea otro `catalog_products` | **No lo hace**: solo inserta en `catalog_retail_snapshots`. |
| Mismo ítem de tienda dos veces | `external_ref` estable (URL o SKU); el vínculo es único por (`retailer`, `external_ref`). |

## Variables de entorno (import)

- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (service_role)
- Opcional: `RETAIL_SQLITE` para forzar ruta al `.db`
