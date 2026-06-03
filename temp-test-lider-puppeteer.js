/**
 * Script temporal desechable: confirma productos y paginacion en Lider via Puppeteer+stealth.
 * Estructura Walmart Glass: initialData.searchResult.itemStacks[].items[].
 * Se borra despues. NO toca codigo de produccion.
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const CATEGORY_URL = 'https://super.lider.cl/browse/alimentos-instantaneos/despensa/sopas-y-cremas/46589040_52225904_18233142';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function humanMouse(page) {
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(200 + Math.random() * 900, 150 + Math.random() * 600, { steps: 6 });
    await sleep(250 + Math.random() * 300);
  }
}

async function getSearchResult(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await humanMouse(page);
  await sleep(2500);
  if (page.url().includes('/blocked')) return { blocked: true };
  const nd = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    return el ? el.textContent : null;
  });
  if (!nd) return { error: 'no __NEXT_DATA__' };
  const data = JSON.parse(nd);
  const sr = data?.props?.pageProps?.initialData?.searchResult;
  if (!sr) return { error: 'no searchResult', keys: Object.keys(data?.props?.pageProps?.initialData || {}) };

  // itemStacks
  const stacks = sr.itemStacks || [];
  const items = [];
  for (const st of stacks) {
    if (Array.isArray(st.items)) {
      for (const it of st.items) {
        if (it && (it.name || it.title) && (it.usItemId || it.id)) {
          items.push({ id: it.usItemId || it.id, name: it.name || it.title,
            price: it.priceInfo?.linePrice || it.price?.displayPrice || it.priceInfo?.currentPrice });
        }
      }
    }
  }
  return {
    srKeys: Object.keys(sr),
    totalCount: sr.count ?? sr.totalCount ?? sr.totalItemCount,
    stacksCount: stacks.length,
    items,
    pagination: sr.pagination,
  };
}

async function main() {
  console.log('=== LIDER: confirmar productos + paginacion ===\n');
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: 'C:/Users/crist/AppData/Local/Temp/lider-profile',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
    defaultViewport: null,
  });
  const page = (await browser.pages())[0] || await browser.newPage();

  console.log('Home (calentar PX)...');
  await page.goto('https://super.lider.cl/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanMouse(page);
  await sleep(6000);

  const results = {};
  for (const pnum of [1, 2, 3]) {
    const url = `${CATEGORY_URL}?page=${pnum}`;
    console.log(`\n--- PAGE ${pnum} ---`);
    const r = await getSearchResult(page, url);
    if (r.blocked) { console.log('  BLOCKED'); continue; }
    if (r.error) { console.log('  ERROR:', r.error, r.keys ? `(initialData keys: ${r.keys.join(',')})` : ''); continue; }
    console.log(`  searchResult keys: ${r.srKeys.join(', ')}`);
    console.log(`  totalCount: ${r.totalCount} | stacks: ${r.stacksCount} | items: ${r.items.length}`);
    if (r.pagination) console.log(`  pagination: ${JSON.stringify(r.pagination).slice(0, 200)}`);
    r.items.slice(0, 4).forEach(s => console.log(`    - ${s.name} (id=${s.id})`));
    results[pnum] = r.items.map(i => i.id);
  }

  // Comparar paginas
  if (results[1] && results[2]) {
    const set1 = new Set(results[1]);
    const overlap = results[2].filter(id => set1.has(id)).length;
    console.log(`\n=== COMPARACION ===`);
    console.log(`Page1: ${results[1].length} ids | Page2: ${results[2].length} ids | overlap: ${overlap}`);
    console.log(overlap === 0 ? 'PAGINACION FUNCIONA (productos distintos)' : 'CUIDADO: productos repetidos');
  }

  console.log('\nClosing in 5s...');
  await sleep(5000);
  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
