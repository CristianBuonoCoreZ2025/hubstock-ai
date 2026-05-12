# Captura de precios por cadena (sin duplicar maestros)

## Lider en volumen (~miles de ítems en minutos)

**No uses la captura web de Next.js como sustituto del scraper de la carpeta `lider/`.**

El flujo probado para **decenas de miles de productos Lider** es:

1. Generar / actualizar `lider/productos_lider.db` (tu scraper local).
2. Importar snapshots con  
   `python scripts/import_retail_snapshots.py --retailer lider --sqlite lider/productos_lider.db`  
   (y opciones `--smart-resolve`, etc. según necesites).

La pantalla **Catálogo → Precios por cadena → Capturar** usa **peticiones HTTP** al sitio en vivo (`super.lider.cl` por defecto): sirve para **muestras, pruebas o actualizaciones chicas**, no compite en velocidad ni volumen con tu SQLite. Eso no es “preferir VTEX”: es solo **otro canal** hacia la misma tabla `catalog_retail_snapshots`.

---

## Partir de cero (solo capturas, no el maestro)

Para vaciar **únicamente** datos de tienda (snapshots + vínculos retail→maestro) y dejar el catálogo maestro intacto, ejecuta en el SQL Editor de Supabase el script:

[`scripts/sql/reset-retail-captures-only.sql`](./sql/reset-retail-captures-only.sql)

Borra `catalog_retail_snapshots`, `catalog_retail_links` y, si existen, las tablas `retail_capture_batches` / `retail_captured_products` / `retail_ai_match_reviews`. No borra `catalog_products`.

---

## Idea central

- **`catalog_products`**: un solo registro por producto “canónico” (nombre de referencia global).
- **`catalog_retail_snapshots`**: cada corrida de import guarda **precio + fecha** por ítem de tienda (`retailer` + `external_ref`). No crea productos nuevos del catálogo.
- **`catalog_retail_links`**: tabla de **homologación**: “este ítem de Jumbo/Lider/Central Mayorista” = “este `catalog_product_id`”. Una fila por (`retailer`, `external_ref`) → un maestro.

La **comparativa inteligente** usa la RPC `catalog_retail_match_candidates` en Postgres (similitud de nombre con `pg_trgm`, cercanía de precio, categoría opcional). La app la usa en **Catálogo → Precios cadenas → Homologar**. El script puede usar la misma RPC más reglas en Python (`retail_import_decision.py`: marca, descripción, umbrales) con `--smart-resolve` y, opcionalmente, alta de maestro con `--create-if-novel`.

## Captura dentro de la aplicación (Next.js, tiempo real)

En **Catálogo → Precios cadenas** podés **barrido web** o **JSON pegado**. Eso llama al **sitio público** de cada cadena (muchas tiendas Cencosud usan stack VTEX detrás; es detalle de implementación, no “la fuente” de tu scraper Lider).

1. **Barrido** — El servidor pide páginas de búsqueda al host configurado (p. ej. Jumbo `jumbo.cl`; Lider suele ser `super.lider.cl`). No es el import masivo desde SQLite.
2. **JSON** — Pegás la respuesta de Network (o HTML con datos parseables) si el barrido falla.

Para **Lider masivo**, seguí usando **`lider/` + `import_retail_snapshots.py`** arriba.

Requiere `SUPABASE_SERVICE_ROLE_KEY` en el servidor y rol **editor** (o superior) en el perfil activo. Los registros se insertan en `catalog_retail_snapshots` con `match_method` `app_vtex_search` o `app_json_import`.

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

### 4. Homologación y alta de maestro (sin duplicar al azar)

**Opción A — Manual**  
**Catálogo → Precios cadenas → Homologar**: mismas sugerencias inteligentes que en servidor (`catalog_retail_match_candidates`: nombre + categoría + precio).

**Opción B — Import inteligente**

```bash
# Solo intenta vínculo cuando el puntaje es alto; zona gris = queda sin vínculo (revisar en UI)
python scripts/import_retail_snapshots.py --retailer jumbo --smart-resolve

# Además crea un maestro nuevo solo cuando la decisión es “producto totalmente nuevo”
# (baja similitud vs catálogo + marca/descripción coherentes con las reglas en retail_import_decision.py)
python scripts/import_retail_snapshots.py --retailer jumbo --smart-resolve --create-if-novel
```

Umbrales ajustables: `--link-min` (default 0.58), `--ambiguous-min` (0.38), `--novel-max` (0.34).

- **Vincular**: puntaje alto y marca compatible con el nombre del candidato.  
- **Ambiguo**: puntaje intermedio, marca que no encaja, o descripción muy parecida al maestro pero puntaje bajo → **no** crea ni enlaza; revisión en UI.  
- **Maestro nuevo** (`create-if-novel`): solo si el mejor candidato está muy por debajo del umbral de novedad y hay separación respecto al segundo candidato; además hace falta mapear la subcategoría SQLite a una categoría PG (taxonomía sincronizada al inicio del script).

Si ya existe vínculo para (`retailer`, `external_ref`), no se sobrescribe.

### 5. Marca propia de cadena → «Marca genérica»

En **verduras, frutas, pan / panadería** y afines, si la marca del SQLite es marca propia (Lider, Jumbo, Central Mayorista, …),
los scripts **`import_lider_sqlite.py`** y **`import_retail_snapshots.py`** sustituyen la marca por el texto canónico **«Marca genérica»**
(entrada en `catalog_brands`) antes de resolver `brand_id`. Así el mismo tomate o marraqueta no queda partido por retailer en el comparativo.

No se reescribe la marca en otros rubros (p. ej. lácteos empaquetados con marca propia) si el nombre/categoría no coincide con el contexto fresco/pan.

### 6. Recapturas e historial de precios

Cada vez que ejecutes el mismo comando de import de snapshots para actualizar precios, se inserta una **nueva** fila en `catalog_retail_snapshots`; el historial queda ordenado por fecha. Los vínculos en `catalog_retail_links` siguen apuntando al mismo maestro.

## Cómo evitar duplicados

| Riesgo | Mitigación |
|--------|------------|
| Mismo producto fresco/pan partido por marca de cadena | Normalización a **«Marca genérica»** en import (paso 5) para comparar sin multiplicar ítems equivalentes. |
| Dos maestros para el mismo producto | Unificar en catálogo (editar / alias) y homologar cada cadena al **mismo** `catalog_product_id`. |
| Import retail crea maestros sin control | Por defecto **no**. Solo con `--create-if-novel` y decisión “producto nuevo”; si no, solo snapshots / vínculos. |
| Mismo ítem de tienda dos veces | `external_ref` estable (URL o SKU); el vínculo es único por (`retailer`, `external_ref`). |

## Variables de entorno (import)

- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (service_role)
- Opcional: `RETAIL_SQLITE` para forzar ruta al `.db`

Después de aplicar migraciones nuevas en Supabase, conviene ejecutar en SQL (si la migración no lo hizo ya): `analyze catalog_retail_snapshots; analyze catalog_retail_links;` para mantener planes de consulta actualizados.
