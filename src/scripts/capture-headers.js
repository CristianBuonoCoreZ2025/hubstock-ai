/**
 * Captura los headers EXACTOS y el body de la request a bff.jumbo.cl/catalog/plp
 * para poder replicarla directamente con fetch.
 */

const puppeteer = require('puppeteer');

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const captured = [];

  // Interceptar la REQUEST para ver headers, method, body
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('bff.jumbo.cl/catalog/plp')) {
      captured.push({
        url,
        method: req.method(),
        headers: req.headers(),
        postData: req.postData(),
      });
    }
  });

  await page.goto('https://www.jumbo.cl/despensa/fideos-pastas-y-salsas?page=2', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  await new Promise(r => setTimeout(r, 4000));

  console.log('Captured', captured.length, 'requests to bff.jumbo.cl/catalog/plp\n');
  for (const c of captured) {
    console.log('========================================');
    console.log('URL:', c.url);
    console.log('METHOD:', c.method);
    console.log('HEADERS:', JSON.stringify(c.headers, null, 2));
    console.log('POST DATA:', c.postData || '(none)');
    console.log();
  }

  await browser.close();
}

main().catch(console.error);
