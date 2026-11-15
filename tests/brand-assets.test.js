'use strict';
// The "Your Seat" brand wiring: every icon the pages and the manifest point at exists with the size it claims, the share image is the
// size its meta tags say, and the old emoji mark is gone from the public pages. A missing or wrong-sized file fails here, not on a phone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exit(1); } }
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
function pngSize(file) {
  const b = fs.readFileSync(path.join(PUB, file));
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file + ' is a PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test('the manifest icons exist and are the size and kind they declare', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  const png = m.icons.filter((i) => i.type === 'image/png');
  assert.ok(png.length >= 3, 'PNG icons for 192, 512 and maskable');
  for (const i of png) {
    const { w, h } = pngSize(i.src.replace(/^\//, ''));
    assert.equal(`${w}x${h}`, i.sizes, i.src + ' matches its declared size');
  }
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon is declared');
  assert.ok(m.icons.some((i) => i.src === '/icon.svg'), 'the SVG icon is declared');
  assert.ok(fs.existsSync(path.join(PUB, 'icon.svg')));
});

test('the home page links its icons and they exist', () => {
  const html = read('index.html');
  for (const href of ['/icon.svg', '/favicon.ico', '/apple-touch-icon.png', '/manifest.webmanifest']) {
    assert.ok(html.includes(`href="${href}"`), `index.html links ${href}`);
    assert.ok(fs.existsSync(path.join(PUB, href.slice(1))), `${href} exists`);
  }
  assert.deepEqual(pngSize('apple-touch-icon.png'), { w: 180, h: 180 });
  const ico = fs.readFileSync(path.join(PUB, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1, 'favicon.ico is an icon file');
});

test('the share image is 1200x630 and the meta tags say so', () => {
  const html = read('index.html');
  assert.deepEqual(pngSize('og-image.png'), { w: 1200, h: 630 });
  assert.match(html, /property="og:image" content="https:\/\/playtableverse\.com\/og-image\.png"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:image" content="https:\/\/playtableverse\.com\/og-image\.png"/);
});

test('the admin page carries the same icons', () => {
  const html = read('admin.html');
  assert.ok(html.includes('href="/icon.svg"') && html.includes('href="/favicon.ico"'));
});

test('the old emoji mark is not used by any public page or script', () => {
  for (const f of ['index.html', 'admin.html', 'scorecard.html', 'app.js', 'admin.js', 'style.css']) {
    assert.ok(!read(f).includes('\u{1F0A1}'), f + ' still uses the old card-glyph mark');
  }
});

test('the loading pulse has a target and respects reduced motion', () => {
  const app = read('app.js'); const i = app.indexOf('<svg class="brand-seat"');
  assert.ok(i > 0, 'the loading screen draws the brand seat');
  assert.ok(app.slice(i, app.indexOf('</svg>', i)).includes('class="seat-halo"'), 'the loading mark contains the element the pulse animates');
  const css = read('style.css');
  assert.match(css, /\.brand \.seat-halo\s*\{[^}]*animation:\s*seat-pulse/);
  assert.match(css, /prefers-reduced-motion:\s*reduce\)\s*\{\s*\.brand \.seat-halo\s*\{\s*animation:\s*none/);
});

console.log(`\n${passed} passed`);
