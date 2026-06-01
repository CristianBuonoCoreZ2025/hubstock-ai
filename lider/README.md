# Scraper de Lider para HUB-STOCK-AI

Lider bloquea peticiones desde servidores (anti-bot PerimeterX). Estos scripts corren en tu PC (IP residencial) donde no hay bloqueo, e insertan productos directamente en Supabase.

## Scripts disponibles

| Script | Descripción | Cuándo usar |
|--------|-------------|-------------|
| `scraper.py` | Scraper original. Guarda en SQLite local y JSON. | Si querés datos locales |
| `scraper_to_supabase.py` | Scraper que inserta directo en Supabase. | **Recomendado**. Inserta directo en la app |
| `upload_to_app.py` | Sube un JSON ya generado a la app via API. | Si ya tenés un JSON de scraper.py |

## Requisitos

```bash
pip install requests
```

Para `scraper_to_supabase.py` también necesitás configurar credenciales (ver abajo).

## Uso recomendado: scraper_to_supabase.py

### 1. Configurar credenciales (una sola vez)

Obtener desde el dashboard de Supabase:
- **URL**: Settings → API → URL (`https://xxxxx.supabase.co`)
- **Service Role Key**: Settings → API → `service_role key` (¡no compartir!)

En Linux/Mac:
```bash
export SUPABASE_URL="https://tu-proyecto.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

En Windows (PowerShell):
```powershell
$env:SUPABASE_URL="https://tu-proyecto.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

### 2. Correr el scraper

```bash
cd lider
python scraper_to_supabase.py
```

El script:
1. Lee las categorías de `raw_categories.json`
2. Scrapea cada subcategoría desde tu PC
3. Inserta productos directamente en la tabla `scrapping`
4. Crea un run en `scrapping_runs`
5. Inserta snapshots en `catalog_retail_snapshots`

Los productos aparecen automáticamente en la app en **Captura Cadenas → Homologación**.

## Uso alternativo: scraper.py + upload_to_app.py

Si preferís el flujo de dos pasos:

```bash
# Paso 1: Scrapear a JSON
python scraper.py

# Paso 2: Subir a la app
python upload_to_app.py --json productos_lider.json --url https://tu-app.vercel.app
```

## Notas importantes

- **Nunca subas el `SUPABASE_SERVICE_ROLE_KEY` a GitHub**. Usalo solo en tu PC local.
- El script tiene delays entre requests para no sobrecargar el servidor de Lider.
- Si Lider cambia su HTML, puede fallar la extracción de `__NEXT_DATA__`. En ese caso, revisar el log de errores.
- Los productos insertados se deduplican por `run_id + retailer + external_ref`.
