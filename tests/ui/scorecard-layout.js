'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('SKIPPED: playwright is not installed'); process.exit(0); }
const PUBLIC = path.join(__dirname, '..', '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const scorecardSource = fs.readFileSync(path.join(PUBLIC, 'scorecard.js'), 'utf8');
if (!scorecardSource.includes('<div class="sc-actions">')) throw new Error('scorecard must use its own action-bar class, not the global navigation .menu');
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
    await page.route('**/scorecard.js', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/scorecard.html`);
    await page.evaluate(() => {
      document.getElementById('sc').innerHTML = `
        <main class="sc">
          <section class="panel"><h2>Round results</h2><button class="btn big" data-act="save">Save round</button></section>
          <div class="sc-actions">
            <button class="btn ghost small">Undo last round</button>
            <button class="btn ghost small">Copy scores</button>
            <button class="btn ghost small">New game</button>
          </div>
        </main>`;
    });
    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const result = await page.evaluate(() => {
        const bar = document.querySelector('.sc-actions'), save = document.querySelector('[data-act="save"]');
        if (!bar || !save) return { error: 'scorecard action bar or save button missing' };
        const a = bar.getBoundingClientRect(), b = save.getBoundingClientRect();
        return { position: getComputedStyle(bar).position, pageWidth: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth, overlap: a.left < b.right - 1 && b.left < a.right - 1 &&
          a.top < b.bottom - 1 && b.top < a.bottom - 1, barTop: a.top, saveBottom: b.bottom };
      });
      if (result.error || result.position !== 'static' || result.pageWidth > result.viewport + 1 || result.overlap || result.barTop < result.saveBottom - 1) {
        failed = true; console.error('FAIL scorecard layout at', width, result);
      } else console.log('ok scorecard action bar at', width);
    }
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
  if (failed) process.exitCode = 1;
})();
