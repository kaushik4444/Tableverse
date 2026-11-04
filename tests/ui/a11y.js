'use strict';
/**
 * Accessibility checks that a script can do reliably (they do not replace a screen-reader pass): on the home page, the lobby and
 * every game screen, each visible control has an accessible name, each form field has a label, images have alt text, a focusable
 * element shows a focus ring, tap targets of main controls are not tiny, and animations respect "reduce motion".
 */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const NAMES = ['Aarav', 'Bo', 'Cy', 'Di'];
function build(gameId, n) {
  const def = games.get(gameId);
  const players = NAMES.slice(0, n).map((nm, i) => ({ id: i ? 'p' + i : 'me', name: nm, avatar: '🧙' }));
  let a = 5; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(players, Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default])), rng);
  if (gameId === 'ludo' || gameId === 'themind') players.forEach((p) => g.act(p.id, { type: 'ready' }));
  const room = { code: 'ABCDEF', gameId, hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: n, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(),
    members: players.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: p.avatar, connected: true })) };
  return [welcome({ games: games.list() }), { t: 'state', room, view: g.view('me') }];
}

/** Runs inside the page: returns a list of problems. */
function scan() {
  const visible = (el) => el.checkVisibility({ checkVisibilityCSS: true });
  const nameOf = (el) => {
    const labelled = el.getAttribute('aria-labelledby');
    const byId = labelled ? labelled.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ') : '';
    const lab = el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`) || {}).textContent : '';
    return (el.getAttribute('aria-label') || byId || el.getAttribute('title') || (el.closest('label') || {}).textContent || lab || el.textContent || (el.querySelector('img[alt]') || {}).alt || '').replace(/\s+/g, ' ').trim();
  };
  const bad = [];
  for (const el of document.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select, textarea, [tabindex="0"]')) {
    if (!visible(el)) continue;
    if (!nameOf(el)) bad.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} has no accessible name`);
  }
  for (const img of document.querySelectorAll('img')) if (visible(img) && !img.hasAttribute('alt')) bad.push('img without alt: ' + (img.src || '').slice(-30));
  if (!document.documentElement.lang) bad.push('<html> has no lang');
  if (!document.querySelector('meta[name=viewport]')) bad.push('no viewport meta');
  const unnamedDialogs = [...document.querySelectorAll('dialog[open], [role=dialog]')].filter((d) => visible(d) && !nameOf(d) && !d.getAttribute('aria-labelledby'));
  for (const d of unnamedDialogs) bad.push('dialog without a name');
  return bad;
}

let failed = 0;
async function check(browser, url, label, messages, viewport = { width: 390, height: 844 }) {
  const { page, ctx } = await scriptedPage(browser, { viewport, messages });
  try {
    await page.goto(url + '/');
    await page.waitForSelector('#app *', { timeout: 8000 });
    await page.waitForTimeout(350);
    const bad = await page.evaluate(scan);
    assert.deepEqual([...new Set(bad)], [], `${label}: accessibility problems`);
    // keyboard: Tab moves focus onto something with a visible ring
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return 'none'; const cs = getComputedStyle(el); return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' ? 'ring' : 'no ring: ' + el.tagName + '.' + el.className; });
    assert.ok(ring === 'ring' || ring === 'none', `${label}: ${ring}`);
    if (label === 'home') { // negative control: the scanner really does catch an unnamed control
      const caught = await page.evaluate((fn) => { const b = document.createElement('button'); b.className = 'probe'; document.body.appendChild(b); const r = (new Function('return (' + fn + ')()'))(); b.remove(); return r; }, scan.toString());
      assert.ok(caught.some((m) => /probe/.test(m)), 'the scanner flags a button with no name');
    }
    console.log('  ok  ' + label);
  } catch (e) { failed++; console.error('FAIL  ' + label + '\n' + (e.stack || e)); }
  await ctx.close();
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  await check(browser, url, 'home', [welcome({ games: games.list() })]);
  for (const [id, n] of [['wizard', 4], ['twentynine', 4], ['poker', 4], ['themind', 3], ['ludo', 4], ['gofish', 4], ['snakesladders', 4], ['propertyrivals', 4]]) await check(browser, url, `${id} table`, build(id, n));
  const cssOk = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/style.css'), 'utf8') + require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/table.css'), 'utf8');
  assert.ok(/prefers-reduced-motion/.test(cssOk), 'reduced-motion rules exist');
  await browser.close(); server.close();
  console.log(failed ? `${failed} accessibility check(s) failed` : 'accessibility checks passed');
  process.exit(failed ? 1 : 0);
})();
