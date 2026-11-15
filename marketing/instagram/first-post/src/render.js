'use strict';
// Renders slides.html (each .slide is 1080x1350) to ../slides/slide-0N.png, and cover.html to ../cover-*.png.
const path = require('node:path'); const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const jobs = [['slides.html', '.slide', (i) => `../slides/slide-0${i + 1}.png`, { width: 1080, height: 1350 }], ['cover.html', '.cover', (i) => ['../cover-square-1080.png', '../cover-link-1200x630.png'][i], null]];
  for (const [file, sel, out, vp] of jobs) {
    const p = await b.newPage({ viewport: vp || { width: 1300, height: 1400 }, deviceScaleFactor: 1 });
    await p.goto('file://' + path.join(__dirname, file)); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
    const els = await p.$$(sel);
    for (let i = 0; i < els.length; i++) { await els[i].screenshot({ path: path.join(__dirname, out(i)) }); console.log('wrote', out(i)); }
    await p.close();
  }
  await b.close();
})();
