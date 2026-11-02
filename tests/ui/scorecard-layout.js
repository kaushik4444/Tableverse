'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('SKIPPED: playwright is not installed'); process.exit(0); }
const PUBLIC = path.join(__dirname, '..', '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = decodeURIComponent(url.pathname === '/' ? '/scorecard.html' : url.pathname);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
(async () => {
  const server = await serve(), browser = await chromium.launch();
  let failed = false;
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/scorecard.html`);
    await page.locator('[data-name="0"]').fill('Alice');
    await page.locator('[data-name="1"]').fill('Bob');
    await page.locator('[data-name="2"]').fill('Cara');
    await page.locator('[data-act="start"]').click();
    await page.locator('[data-act="tricks"]').click();
    await page.locator('[data-act="inc"][data-i="0"]').click();
    await page.locator('[data-act="save"]').waitFor();
    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const result = await page.evaluate(() => {
        const bar = document.querySelector('.sc-actions'), save = document.querySelector('[data-act="save"]');
        if (!bar || !save) return { error: 'scorecard action bar or save button missing' };
        const a = bar.getBoundingClientRect(), b = save.getBoundingClientRect();
        return { position: getComputedStyle(bar).position, pageWidth: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
          overlap: a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1 };
      });
      if (result.error || result.position !== 'static' || result.pageWidth > result.viewport + 1 || result.overlap) {
        failed = true; console.error('FAIL scorecard layout at', width, result);
      } else console.log('ok scorecard action bar at', width);
    }
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
  if (failed) process.exitCode = 1;
})();
