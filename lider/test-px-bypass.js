/**
 * Prueba alternativa para pasar PerimeterX:
 * - Navegacion desde Google (referrer natural)
 * - Perfil completamente nuevo
 * - Mayor tiempo de espera
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const NEW_PROFILE = 'C:/Users/crist/AppData/Local/Temp/lider-px-test-' + Date.now();

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function humanMouse(page) {
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(200 + Math.random() * 900, 150 + Math.random() * 500, { steps: 8 });
    await sleep(400 + Math.random() * 400);
  }
  await page.evaluate(() => window.scrollBy(0, 300));
  await sleep(800);
}

async function main() {
  console.log('PX Bypass Test - profile:', NEW_PROFILE);
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: NEW_PROFILE,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,768',
    ],
    defaultViewport: { width: 1366, height: 768 },
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'es-CL,es;q=0.9',
  });

  // Metodo 1: Ir a Google y buscar Lider
  console.log('\n1) Google -> Lider...');
  await page.goto('https://www.google.com', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  await page.click('textarea[name="q"]');
  await page.type('textarea[name="q"]', 'supermercado lider chile', { delay: 100 });
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(3000);

  // Buscar link a lider.cl
  const liderLink = await page.$('a[href*="lider.cl"]');
  if (liderLink) {
    console.log('   Clicking Lider result...');
    await liderLink.click();
    await sleep(6000);
  } else {
    console.log('   No Lider link found, navigating direct...');
    await page.goto('https://super.lider.cl/', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(4000);
  }

  const homeUrl = page.url();
  const homeBlocked = homeUrl.includes('/blocked');
  console.log('   Home URL:', homeUrl.slice(0, 70));
  console.log('   Home blocked:', homeBlocked);

  if (homeBlocked) {
    console.log('\n❌ Home blocked. Trying Method 2 (direct with longer wait)...');
  } else {
    console.log('\n✓ Home OK! Navigating to category...');
    await humanMouse(page);
    await sleep(3000);

    // Categoria
    await page.goto('https://super.lider.cl/browse/alimentos-instantaneos/despensa/sopas-y-cremas/46589040_52225904_18233142', {
      waitUntil: 'networkidle2', timeout: 45000
    });
    await humanMouse(page);
    await sleep(3000);

    const catUrl = page.url();
    const catBlocked = catUrl.includes('/blocked');
    console.log('   Cat URL:', catUrl.slice(0, 70));
    console.log('   Cat blocked:', catBlocked);

    if (!catBlocked) {
      const nd = await page.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        return el ? el.textContent : null;
      });
      if (nd) {
        const data = JSON.parse(nd);
        const sr = data?.props?.pageProps?.initialData?.searchResult;
        if (sr) {
          const items = sr.itemStacks?.[0]?.items || [];
          console.log(`\n✓ SUCCESS! Found ${items.length} products`);
          items.slice(0, 3).forEach(p => console.log(`  - ${p.name}`));
        }
      }
    }
  }

  console.log('\nClosing in 10s...');
  await sleep(10000);
  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
