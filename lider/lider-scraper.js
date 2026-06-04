#!/usr/bin/env node
/**
 * Scraper de Lider (super.lider.cl) con Puppeteer + stealth.
 *
 * IMPORTANTE - PerimeterX (PX):
 *   La primera vez que corres el script, PX puede mostrar un challenge
 *   "Humano o robot - presiona y mantén". El script PAUSA y muestra
 *   el navegador. Vos resolvés el challenge manualmente (presioná el botón
 *   durante unos segundos) y el script continúa solo automáticamente.
 *   Las cookies se guardan en el perfil para futuras ejecuciones.
 *
 * Requiere:
 *   npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
 *   (ya instalados en el proyecto)
 *
 * Variables de entorno:
 *   SUPABASE_URL=https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 * Uso:
 *   node lider/lider-scraper.js
 *   node lider/lider-scraper.js --max-categories=5
 *   node lider/lider-scraper.js --category-url="https://super.lider.cl/browse/..."
 */

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

const fs = require('fs')
const path = require('path')

/**
 * Carga variables desde un archivo .env (sin dependencias externas).
 * Soporta: KEY=valor, KEY="valor", comentarios (#), líneas vacías.
 */
function loadEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split(/\r?\n/)
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx === -1) continue
      const key = line.slice(0, idx).trim()
      let value = line.slice(idx + 1).trim()
      // Quitar comillas envolventes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key && process.env[key] == null) {
        process.env[key] = value
      }
    }
  } catch {
    // Si no existe el archivo, ignorar silenciosamente
  }
}

// Cargar .env.local desde la raíz del proyecto (1 nivel arriba de lider/)
const envPath = path.join(__dirname, '..', '.env.local')
loadEnvFile(envPath)

// ─── CONFIG ───
const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '')
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
)
const BASE_URL = 'https://super.lider.cl'
const CATEGORIES_FILE = path.join(__dirname, 'raw_categories.json')
const USER_DATA_DIR = path.join(process.env.LOCALAPPDATA || process.env.TMP || '/tmp', 'lider-puppeteer-profile')

const REQUEST_DELAY_MS = 1200
const PX_WARMUP_MS = 4000
const PAGE_TIMEOUT = 45000
const MAX_PAGES_PER_CATEGORY = 50

// CLI args
const args = process.argv.slice(2)
const maxCategoriesArg = args.find(a => a.startsWith('--max-categories='))
const maxCategories = maxCategoriesArg ? parseInt(maxCategoriesArg.split('=')[1], 10) : Infinity
const singleUrlArg = args.find(a => a.startsWith('--category-url='))
const singleUrl = singleUrlArg ? singleUrlArg.split('=')[1] : null

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: definí SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')
  console.error('Ejemplo:')
  console.error('  set SUPABASE_URL=https://tu-proyecto.supabase.co')
  console.error('  set SUPABASE_SERVICE_ROLE_KEY=eyJ...')
  process.exit(1)
}

// ─── SUPABASE REST HELPERS ───
const REST_BASE = `${SUPABASE_URL}/rest/v1`
const REST_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

async function restGet(table, query = '') {
  const res = await fetch(`${REST_BASE}/${table}${query}`, { headers: REST_HEADERS })
  if (!res.ok) throw new Error(`GET ${table} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function restUpsert(table, rows, onConflictCols = 'run_id,retailer,external_ref,listing_url') {
  const url = `${REST_BASE}/${table}?on_conflict=${onConflictCols}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...REST_HEADERS,
      Prefer: 'return=minimal, resolution=ignore-duplicates',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST ${table} → ${res.status}: ${text}`)
  }
  // return=minimal → body vacío, no parsear JSON
  return { ok: true, count: rows.length }
}

async function restPost(table, rows, prefer = 'return=representation') {
  const res = await fetch(`${REST_BASE}/${table}`, {
    method: 'POST',
    headers: { ...REST_HEADERS, Prefer: prefer },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST ${table} → ${res.status}: ${text}`)
  }
  // return=minimal → body vacío, no parsear JSON
  if (prefer.includes('return=minimal')) {
    return { ok: true, count: rows.length }
  }
  return res.json()
}

// ─── LIDER HELPERS ───
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function humanMouse(page) {
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(200 + Math.random() * 900, 150 + Math.random() * 600, { steps: 6 })
    await sleep(250 + Math.random() * 300)
  }
  await page.evaluate(() => window.scrollBy(0, 400))
  await sleep(600)
}

function isBlocked(finalUrl, html = '') {
  if (finalUrl.includes('/blocked')) return true
  if (/Robot or human|px-captcha|Press & Hold|press and hold/i.test(html)) return true
  return false
}

function hasPxChallenge(html) {
  return /Robot or human|px-captcha|Press & Hold|press and hold|verify you are human/i.test(html)
}

function extractSectionCategoryFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    if (parts.length >= 3 && parts[0] === 'browse') {
      return {
        section: parts[1]?.replace(/-/g, ' ') || null,
        category: parts[2]?.replace(/-/g, ' ') || null,
        subcategory: parts[3]?.replace(/-/g, ' ') || null,
      }
    }
  } catch { /* ignore */ }
  return { section: null, category: null, subcategory: null }
}

function parsePrice(raw) {
  if (!raw) return 0
  const cleaned = String(raw).replace('$', '').replace(/\./g, '').replace(',', '.').replace(/\s*x.*$/, '').trim()
  const n = parseFloat(cleaned)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function stableHash(v) {
  const s = JSON.stringify(v)
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

// ─── PX CHALLENGE WAITER ───
async function waitForPxChallengeToResolve(page, label) {
  let attempts = 0
  const maxAttempts = 60 // 60 * 3s = 3 minutos max
  let firstAlert = true
  while (attempts < maxAttempts) {
    let html = ''
    let url = ''
    try {
      // Esperar a que el frame esté estable (podria navegar por redireccion post-challenge)
      await page.waitForFunction(() => document.readyState === 'complete', { timeout: 2000 }).catch(() => {})
      url = page.url()
      html = await page.content()
    } catch {
      // Navegacion en progreso despues del challenge, esperar
      url = page.url()
    }
    if (!hasPxChallenge(html) && !url.includes('/blocked')) {
      console.log(`\n  ✓ ${label} cargó correctamente (challenge resuelto)`)
      return true
    }
    if (firstAlert) {
      console.log(`\n  ⚠️ PX Challenge detectado en ${label}`)
      console.log(`  → RESOLVÉ EL DESAFÍO MANUALMENTE EN EL NAVEGADOR`)
      console.log(`  → (Presioná y mantené el botón "Soy humano")`)
      console.log(`  → El script sigue solo cuando detecta que pasó...`)
      firstAlert = false
    }
    process.stdout.write(`  Esperando resolución del challenge... (${attempts + 1}/${maxAttempts})\r`)
    await sleep(3000)
    attempts++
  }
  console.log(`\n  ✗ Timeout esperando resolución del challenge`)
  return false
}

// ─── EXTRACTION ───
function extractProductsFromPageProps(pageProps) {
  const initialData = pageProps?.initialData || {}
  const searchResult = initialData.searchResult || {}
  const itemStacks = searchResult.itemStacks || []
  const products = []

  for (const stack of itemStacks) {
    if (!Array.isArray(stack.items)) continue
    for (const item of stack.items) {
      const typename = item?.__typename || ''
      if (typename === 'TileTakeOverProductPlaceholder' || typename === 'AdPlaceholder') continue
      const name = item.name || item.title || ''
      if (!name) continue

      const priceInfo = item.priceInfo || {}
      const imageInfo = item.imageInfo || {}
      const imageObj = item.image || {}

      let imageUrl = ''
      if (imageInfo.thumbnailUrl) imageUrl = imageInfo.thumbnailUrl
      else if (typeof imageObj === 'object' && imageObj.thumbnailUrl) imageUrl = imageObj.thumbnailUrl
      else if (typeof imageObj === 'string') imageUrl = imageObj

      const productId = item.usItemId || item.id || ''
      const canonicalUrl = item.canonicalUrl || ''

      products.push({
        id: String(productId),
        nombre: name,
        marca: item.brand || item.manufacturerName || '',
        fabricante: item.manufacturerName || '',
        precio: priceInfo.linePrice || priceInfo.currentPrice?.price || '',
        precio_anterior: priceInfo.wasPrice || '',
        precio_unitario: priceInfo.unitPrice || '',
        imagen_url: imageUrl,
        url_producto: canonicalUrl ? `${BASE_URL}${canonicalUrl}` : '',
        descripcion_corta: item.shortDescription || '',
      })
    }
  }

  const totalCount = searchResult.count ?? searchResult.totalCount ?? searchResult.totalItemCount ?? 0
  return { products, totalCount }
}

async function scrapeCategoryPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT })
  await humanMouse(page)
  await sleep(1500)

  const finalUrl = page.url()
  const html = await page.content()

  if (hasPxChallenge(html) || finalUrl.includes('/blocked')) {
    const resolved = await waitForPxChallengeToResolve(page, `página ${url.slice(-40)}`)
    if (!resolved) return { blocked: true }
  }

  const nextData = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__')
    return el ? el.textContent : null
  })
  if (!nextData) {
    return { error: 'No __NEXT_DATA__ found', finalUrl }
  }

  let data
  try {
    data = JSON.parse(nextData)
  } catch {
    return { error: 'Invalid JSON in __NEXT_DATA__', finalUrl }
  }

  const pp = data?.props?.pageProps
  if (!pp) {
    return { error: 'No pageProps', finalUrl }
  }

  const { products, totalCount } = extractProductsFromPageProps(pp)
  return { products, totalCount, finalUrl }
}

async function scrapeAllPagesForCategory(browser, categoryUrl, sectionName, categoryName) {
  console.log(`\n  → ${sectionName} › ${categoryName}`)
  console.log(`    URL: ${categoryUrl}`)

  const page = await browser.newPage()
  const allProducts = []
  const seenIds = new Set()
  let pageNum = 1

  try {
    while (pageNum <= MAX_PAGES_PER_CATEGORY) {
      const url = pageNum === 1 ? categoryUrl : `${categoryUrl}${categoryUrl.includes('?') ? '&' : '?'}page=${pageNum}`
      console.log(`    Fetching page ${pageNum}...`)

      const result = await scrapeCategoryPage(page, url)
      if (result.blocked) {
        console.log(`    ⚠️ BLOCKED by PerimeterX on page ${pageNum}`)
        break
      }
      if (result.error) {
        console.log(`    ⚠️ ERROR: ${result.error}`)
        break
      }

      const newProducts = result.products.filter(p => {
        const key = p.id || p.nombre
        if (seenIds.has(key)) return false
        seenIds.add(key)
        return true
      })

      console.log(`    Page ${pageNum}: ${newProducts.length} products (total so far: ${allProducts.length + newProducts.length})`)
      allProducts.push(...newProducts)

      if (newProducts.length === 0) {
        console.log(`    ✓ No more products (empty page). Stopping.`)
        break
      }

      pageNum++
      if (pageNum <= MAX_PAGES_PER_CATEGORY) {
        await sleep(REQUEST_DELAY_MS)
      }
    }
  } finally {
    await page.close()
  }

  // Enrich with section/category from URL path
  const pathInfo = extractSectionCategoryFromUrl(categoryUrl)
  for (const p of allProducts) {
    p.categoria = pathInfo.section || sectionName || ''
    p.subcategoria = pathInfo.category || categoryName || ''
    p.subsubcategoria = pathInfo.subcategory || ''
  }

  return allProducts
}

// ─── SUPABASE UPLOAD ───
async function getRetailId() {
  const rows = await restGet('retail', '?select=id,name&name=ilike.*Lider*')
  if (Array.isArray(rows) && rows.length > 0) return rows[0].id
  return null
}

async function createScrappingRun(retailId) {
  const now = new Date().toISOString()
  const payload = {
    retailer: 'lider',
    source_chain: 'lider',
    retail_id: retailId,
    status: 'running',
    total_pages: 0,
    pages_done: 0,
    pages_ok: 0,
    pages_failed: 0,
    rows_inserted: 0,
    started_at: now,
  }
  const rows = await restPost('scrapping_runs', payload)
  return rows?.[0]?.id
}

async function uploadProducts(products, runId) {
  if (products.length === 0) return 0

  const extractedAt = new Date().toISOString()
  const scrappingRows = []
  const snapshotRows = []

  for (const p of products) {
    const name = p.nombre.trim()
    if (!name) continue

    const price = parsePrice(p.precio)
    const id = (p.id || '').trim()
    const productUrl = (p.url_producto || '').trim()
    const brand = (p.marca || p.fabricante || '').trim() || null
    const imageUrl = (p.imagen_url || '').trim() || null
    const section = (p.categoria || '').trim() || null
    const category = (p.subcategoria || '').trim() || null
    const externalRef = id || productUrl || `local:${stableHash(name + String(price))}`

    scrappingRows.push({
      run_id: runId,
      retailer: 'lider',
      external_ref: externalRef,
      product_url: productUrl,
      product_name: name,
      brand,
      price,
      currency: 'CLP',
      source_chain: 'lider',
      listing_url: productUrl,
      sections: section,
      categories: category,
      image_url: imageUrl,
      extracted_at: extractedAt,
    })

    snapshotRows.push({
      retailer: 'lider',
      external_ref: externalRef,
      source_url: productUrl || null,
      title: name,
      price,
      category_hint: category ?? section ?? null,
      brand_hint: brand,
      captured_at: extractedAt,
      match_method: 'puppeteer_local_stealth',
    })
  }

  // Insert scrapping in chunks (upsert)
  const chunk = 50
  let inserted = 0
  for (let i = 0; i < scrappingRows.length; i += chunk) {
    const slice = scrappingRows.slice(i, i + chunk)
    try {
      await restUpsert('scrapping', slice)
      inserted += slice.length
    } catch (e) {
      console.log(`    ⚠️ scrapping upsert failed: ${e.message}`)
      inserted += 0
    }
  }

  // Insert snapshots (direct insert, no upsert — tabla de historial)
  const snapChunk = 200
  for (let i = 0; i < snapshotRows.length; i += snapChunk) {
    const slice = snapshotRows.slice(i, i + snapChunk)
    try {
      await restPost('catalog_retail_snapshots', slice, 'return=minimal')
    } catch (e) {
      console.log(`    ⚠️ snapshots insert failed: ${e.message}`)
    }
  }

  return inserted
}

async function finalizeRun(runId, inserted, totalPages, okPages, failedPages) {
  const now = new Date().toISOString()
  await fetch(`${REST_BASE}/scrapping_runs?id=eq.${runId}`, {
    method: 'PATCH',
    headers: REST_HEADERS,
    body: JSON.stringify({
      status: 'completed',
      rows_inserted: inserted,
      total_pages: totalPages,
      pages_done: okPages + failedPages,
      pages_ok: okPages,
      pages_failed: failedPages,
      finished_at: now,
    }),
  })
}

// ─── MAIN ───
async function main() {
  console.log('=== LIDER SCRAPER (Puppeteer + Stealth + Manual PX Support) ===')
  console.log(`Profile dir: ${USER_DATA_DIR}`)
  console.log('')
  console.log('INSTRUCCIONES:')
  console.log('  1. Se abrirá Chrome visible.')
  console.log('  2. Si PX muestra "Soy humano", RESOLVÉLO MANUALMENTE.')
  console.log('  3. El script detecta automáticamente cuando pasa y sigue solo.')
  console.log('  4. Las cookies se guardan para futuras ejecuciones.')
  console.log('')

  // Load categories
  let categories = []
  if (singleUrl) {
    categories = [{ section: 'Manual', name: 'Single', url: singleUrl }]
  } else {
    if (!fs.existsSync(CATEGORIES_FILE)) {
      console.error(`Categories file not found: ${CATEGORIES_FILE}`)
      process.exit(1)
    }
    const raw = JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8'))
    for (const [sectionName, sectionData] of Object.entries(raw)) {
      for (const sub of sectionData.subcategories || []) {
        categories.push({ section: sectionName, name: sub.name, url: sub.url })
      }
    }
  }

  if (!isFinite(maxCategories)) {
    console.log(`Total categories: ${categories.length}`)
  } else {
    categories = categories.slice(0, maxCategories)
    console.log(`Categories to scrape: ${categories.length} (limited by --max-categories)`)
  }

  // Get retail ID
  const retailId = await getRetailId()
  if (!retailId) {
    console.error('Could not find Lider retail ID in database')
    process.exit(1)
  }
  console.log(`Retail ID: ${retailId}`)

  // Create run
  const runId = await createScrappingRun(retailId)
  console.log(`Run ID: ${runId}`)

  // Launch browser
  console.log('\nLaunching Chrome (visible)...')
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: USER_DATA_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--window-size=1366,768',
      '--start-maximized',
    ],
    defaultViewport: { width: 1366, height: 768 },
    ignoreDefaultArgs: ['--enable-automation'],
  })

  let totalInserted = 0
  let totalPages = 0
  let okPages = 0
  let failedPages = 0

  try {
    // Warm up: visit homepage (detects and waits for PX challenge)
    console.log('\nWarming up on homepage...')
    const warmupPage = await browser.newPage()
    await warmupPage.setExtraHTTPHeaders({
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
    })
    await warmupPage.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2000)

    const warmupResolved = await waitForPxChallengeToResolve(warmupPage, 'homepage')
    if (!warmupResolved) {
      console.error('\n❌ No se pudo pasar el challenge de PX en la home. Abortando.')
      process.exit(1)
    }

    await humanMouse(warmupPage)
    await sleep(PX_WARMUP_MS)
    await warmupPage.close()
    console.log('✓ Homepage ready. Starting categories...')

    // Scrape each category
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i]
      console.log(`\n[${i + 1}/${categories.length}] ${cat.section} › ${cat.name}`)

      try {
        const products = await scrapeAllPagesForCategory(browser, cat.url, cat.section, cat.name)
        if (products.length > 0) {
          const inserted = await uploadProducts(products, runId)
          totalInserted += inserted
          okPages++
          console.log(`  ✓ Inserted ${inserted} products`)
        } else {
          console.log(`  ⚠️ No products found`)
          failedPages++
        }
        totalPages++
      } catch (e) {
        console.log(`  ❌ Error: ${e.message}`)
        failedPages++
        totalPages++
      }

      // Small delay between categories
      if (i < categories.length - 1) {
        await sleep(REQUEST_DELAY_MS)
      }
    }
  } finally {
    console.log('\nClosing browser...')
    await browser.close()
  }

  // Finalize
  await finalizeRun(runId, totalInserted, totalPages, okPages, failedPages)

  console.log('\n=== DONE ===')
  console.log(`Total products inserted: ${totalInserted}`)
  console.log(`Categories OK: ${okPages} | Failed: ${failedPages}`)
  console.log(`Run ID: ${runId}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
