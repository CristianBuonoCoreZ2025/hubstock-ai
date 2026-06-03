# Scraper de Lider para HUB-STOCK-AI

Lider bloquea peticiones desde servidores (anti-bot PerimeterX). Estos scripts corren en tu PC (IP residencial) donde no hay bloqueo, e insertan productos directamente en Supabase.

## Scripts disponibles

| Script | Descripción | Cuándo usar |
|--------|-------------|-------------|
| `lider-scraper.js` | **NUEVO** Scraper con Puppeteer + stealth. Pasa PerimeterX. | **Recomendado**. Inserta directo en la app con paginación completa |
| `scraper_to_supabase.py` | Scraper Python legacy con `requests`. | **NO FUNCIONA** — Lider bloquea con PX |
| `scraper.py` | Scraper original. Guarda en SQLite local. | **NO FUNCIONA** — Lider bloquea con PX |
| `upload_to_app.py` | Sube un JSON ya generado a la app via API. | Si ya tenés un JSON viejo |

## Script recomendado: lider-scraper.js

Este script usa **Puppeteer con stealth plugin** para abrir Chrome como un navegador real, pasar el anti-bot de PerimeterX, y extraer productos directamente del `__NEXT_DATA__` de Lider. Captura **todas las páginas** de cada categoría (paginación completa).

### Requisitos

```bash
# Ya instalados en el proyecto
npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
```

### Configurar credenciales (una sola vez)

Obtener desde el dashboard de Supabase:
- **URL**: Settings → API → URL (`https://xxxxx.supabase.co`)
- **Service Role Key**: Settings → API → `service_role key` (¡no compartir!)

En Windows (PowerShell):
```powershell
$env:SUPABASE_URL="https://tu-proyecto.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

En Linux/Mac:
```bash
export SUPABASE_URL="https://tu-proyecto.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

### Uso

```bash
# Scrapear TODAS las categorías (puede tardar ~30-60 min)
node lider/lider-scraper.js

# Scrapear solo 5 categorías (prueba rápida)
node lider/lider-scraper.js --max-categories=5

# Scrapear una categoría específica
node lider/lider-scraper.js --category-url="https://super.lider.cl/browse/..."
```

### ¿Qué hace el script?

1. **Abre Chrome visible** con perfil persistente (las cookies se guardan)
2. **Va a la home de Lider** y detecta automáticamente si PX muestra el challenge "Soy humano"
3. **Si aparece el challenge**: el script PAUSA y muestra instrucciones en la consola. Vos resolvés el desafío manualmente en el navegador (presioná y mantené el botón ~5 segundos). El script detecta automáticamente cuando pasó y **sigue solo**.
4. **Navega cada categoría** de `raw_categories.json` paginando automáticamente (`?page=1`, `?page=2`...) hasta agotar los productos
5. **Inserta productos** directamente en:
   - `scrapping` — productos scrapeados para homologación
   - `scrapping_runs` — registro de la corrida
   - `catalog_retail_snapshots` — historial de precios

### Notas importantes sobre PerimeterX

- **La primera ejecución** probablemente pida el challenge "Soy humano". Resolvelo una vez y las cookies quedan guardadas en el perfil persistente.
- **Las siguientes ejecuciones** probablemente pasen automáticamente sin pedir challenge (las cookies persisten).
- Si tu IP queda marcada por muchos intentos fallidos, PX puede volver a pedir el challenge. En ese caso, resolvelo de nuevo.
- **Nunca subas el `SUPABASE_SERVICE_ROLE_KEY` a GitHub**. Usalo solo en tu PC local.

## Scripts legacy (NO funcionan con PX)

Estos scripts usan `requests` (Python) que PerimeterX bloquea inmediatamente. Quedan documentados por compatibilidad pero **no sirven** para Lider actual:

```bash
# NO FUNCIONA — PX bloquea
python lider/scraper_to_supabase.py

# NO FUNCIONA — PX bloquea
python lider/scraper.py
```

## Solución de problemas

| Problema | Solución |
|----------|----------|
| "Homepage blocked by PerimeterX" | Borrá el perfil: `rmdir /s /q %LOCALAPPDATA%\lider-puppeteer-profile` y probá de nuevo |
| "No __NEXT_DATA__ found" | Lider cambió su estructura. Revisar el HTML con el navegador abierto |
| "Execution context was destroyed" | Navegación durante challenge. El script ya maneja esto automáticamente |
| Snapshots no se insertan | Verificar que `catalog_retail_snapshots` existe en Supabase |
