/**
 * Captura las respuestas de red (XHR/fetch) que hace el navegador de Jumbo
 * al cargar páginas distintas. Buscamos el endpoint real de productos paginados.
 */

const puppeteer = require('puppeteer');

async function capturePageApi(page, url) {
  const apiResponses = [];

  const handler = async (response) => {
    const respUrl = response.url();
    const ct = response.headers()['content-type'] || '';
    // Capturar respuestas JSON que puedan contener productos
    if (ct.includes('application/json') && respUrl.includes('jumbo.cl')) {
      try {
        const json = await response.json();
        // Buscar si contiene productos
        const text = JSON.stringify(json);
        if (text.includes('"products"') || text.includes('"items"') || text.includes('productId') || text.includes('reference')) {
          apiResponses.push({ url: respUrl, json });
        }
      } catch {}
    }
  };

  page.on('response', handler);

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));

  page.off('response', handler);

  return apiResponses;
}

function extractNamesFromJson(json) {
  const names = [];
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    // Si tiene productos con items
    if (Array.isArray(obj.products)) {
      for (const p of obj.products) {
        const item = p.items?.[0];
        const name = item?.name || p.name || p.productName;
        if (name) names.push(name);
      }
    }
    for (const key of Object.keys(obj)) {
      walk(obj[key]);
    }
  };
  walk(json);
  return names;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const urls = [
    'https://www.jumbo.cl/despensa/fideos-pastas-y-salsas?page=2',
    'https://www.jumbo.cl/despensa/fideos-pastas-y-salsas?page=3',
  ];

  for (const url of urls) {
    console.log('\n========================================');
    console.log('URL:', url);
    console.log('========================================');
    const responses = await capturePageApi(page, url);
    console.log('JSON responses captured:', responses.length);

    for (const r of responses) {
      const names = extractNamesFromJson(r.json);
      if (names.length > 0) {
        console.log('\n  API:', r.url.slice(0, 120));
        console.log('  Products found:', names.length);
        console.log('  First 3:', names.slice(0, 3).join(' | '));
      }
    }
  }

  await browser.close();
}

main().catch(console.error);
