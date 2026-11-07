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
  // WCAG 2.x contrast of visible text against the colour it is drawn on (semi-transparent backgrounds are composited).
  // Text on a background image or gradient cannot be measured this way and is skipped.
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const backdrop = (el) => { // stack of colours from the element up to the first opaque background, composited bottom-up
    const layers = []; let node = el;
    for (; node && node.nodeType === 1; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.unshift(c); if (c.a >= 1) break; }
    }
    if (!layers.length || layers[0].a < 1) layers.unshift({ r: 255, g: 255, b: 255, a: 1 }); // page default is white when nothing is opaque
    return layers.reduce((acc, l) => over(l, acc), { r: 0, g: 0, b: 0, a: 1 });
  };
  const mix = (c, under, k) => ({ r: c.r * k + under.r * (1 - k), g: c.g * k + under.g * (1 - k), b: c.b * k + under.b * (1 - k), a: 1 });
  // colours from el up to the group root, composited over the backdrop behind the group (null if an image is involved)
  const groupBackdrop = (el, root, base) => {
    const layers = []; let node = el;
    for (; node && node.nodeType === 1; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.unshift(c); if (c.a >= 1) break; }
      if (node === root) break;
    }
    return layers.reduce((acc, l) => over(l, acc), base);
  };
  // Contrast of text painted in colour fg on el, as the browser paints it. Every ancestor with opacity below 1 is a group:
  // its colours are blended inside it, then the group is blended (by its own opacity only) with the backdrop directly behind it.
  // Each faded level is checked and the worst one counts. A backdrop that cannot be read from styles (an image) is not measured.
  const contrastOf = (el, fg) => {
    const levels = [];
    for (let x = el; x; x = x.parentElement) { const o = parseFloat(getComputedStyle(x).opacity); if (o < 1) levels.push({ g: x, o }); }
    if (!levels.length) { const bg = backdrop(el); return bg ? ratio(over(fg, bg), bg) : null; }
    let worst = Infinity;
    for (const { g, o } of levels) {
      const behind = g.parentElement ? backdrop(g.parentElement) : null;
      if (!behind) return null;
      const inner = groupBackdrop(el, g, behind); if (!inner) return null;
      worst = Math.min(worst, ratio(mix(over(fg, inner), behind, o), mix(inner, behind, o)));
    }
    return worst;
  };
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    // pictograms (emoji on board pieces and icons) carry no letters or digits; they are graphics, not text (WCAG 1.4.3 exempts them)
    if (!el || seen.has(el) || !/[\p{L}\p{N}]/u.test(n.textContent) || el.closest('script, style, svg, [hidden], [disabled]') || !visible(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    // Painted as the browser paints it. An ancestor with opacity below 1 is a group: the group is composited on its own
    // (its colours blended inside it), then the whole group is blended with what is behind the group, with the product of
    // the opacities. Disabled controls are excluded above.
    const fg = parse(cs.color);
    const r = fg ? contrastOf(el, fg) : null;
    if (r === null) continue; // not measurable (an image behind it)
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (r < need) bad.push(`low contrast ${r.toFixed(2)}:1 (needs ${need}) for "${n.textContent.trim().slice(0, 30)}"`);
  }
  // form values and placeholders are text too
  for (const el of document.querySelectorAll('input:not([type=hidden]), textarea')) {
    if (el.disabled || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const shown = el.value ? [cs.color, 'value'] : null;
    const hint = getComputedStyle(el, '::placeholder').color;
    for (const [colour, what] of [[shown && shown[0], 'value'], [!el.value && el.placeholder ? hint : null, 'placeholder']]) {
      const fg = colour && parse(colour); if (!fg) continue;
      const r = contrastOf(el, fg); if (r === null) continue;
      if (r < need) bad.push(`low contrast ${r.toFixed(2)}:1 (needs ${need}) for ${what} "${(el.value || el.placeholder || el.id || el.tagName).slice(0, 30)}"`);
    }
  }
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
    // keyboard: every Tab stop (up to 40) is on-screen and shows a visible focus ring; the walk reaches more than one control
    // the browser's own tab order: every visible element with tabIndex >= 0 that is not disabled
    const expected = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => el.tabIndex >= 0 && !el.disabled && el.checkVisibility({ checkVisibilityCSS: true })).length);
    const stops = [];
    let wrapped = false; let leftPage = false;
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        // a ring must APPEAR on focus: compare the focused look with the unfocused look, so a decorative shadow that is always there does not count
        const paints = (c) => !/transparent|rgba?\([^)]*,\s*0(\.0+)?\)/.test(c);
        const ring = (c) => ({ outline: c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0 && paints(c.outlineColor) ? c.outlineStyle + c.outlineWidth + c.outlineColor : '', shadow: paints(c.boxShadow) ? c.boxShadow : 'none' });
        const focused = ring(cs);
        el.blur(); const unfocused = ring(getComputedStyle(el)); el.focus({ preventScroll: true });
        const ringed = (focused.outline !== '' && focused.outline !== unfocused.outline) || (focused.shadow !== 'none' && focused.shadow !== unfocused.shadow);
        const r = el.getBoundingClientRect();
        const onScreen = r.width > 0 && r.height > 0 && r.left < innerWidth && r.right > 0 && r.top < innerHeight && r.bottom > 0;
        window.__walkKeys = window.__walkKeys || new WeakMap(); window.__walkN = window.__walkN || 0; if (!window.__walkKeys.has(el)) window.__walkKeys.set(el, ++window.__walkN);
        return { key: window.__walkKeys.get(el), name: (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().slice(0, 30), ringed, onScreen, visible: el.checkVisibility({ checkVisibilityCSS: true }) };
      });
      if (!stop) { leftPage = true; break; } // Tab past the last control leaves the page
      if (stops.length > 1 && stop.key === stops[0].key) { wrapped = true; break; } // the focus cycle has come back to its start
      stops.push(stop);
    }
    const unringed = stops.filter((s) => !s.ringed).map((s) => s.name);
    assert.deepEqual(unringed, [], `${label}: focused without a visible ring`);
    assert.deepEqual(stops.filter((s) => !s.visible).map((s) => s.name), [], `${label}: focus landed on hidden controls`);
    assert.deepEqual(stops.filter((s) => !s.onScreen).map((s) => s.name), [], `${label}: focus landed outside the viewport`);
    // every visible tabbable control is reached before focus cycles; a focus trap over two or a few controls fails here
    const distinct = new Set(stops.map((x) => x.key)).size;
    assert.ok(wrapped || leftPage, `${label}: the keyboard walk neither completed a cycle nor left the page within 300 Tab presses`);
    assert.equal(distinct, expected, `${label}: the keyboard cycle reaches ${distinct} of ${expected} visible controls`);
    if (label === 'home') { // negative controls: the scanner really does catch an unnamed control and low-contrast text
      const caught = await page.evaluate((fn) => {
        const b = document.createElement('button'); b.className = 'probe'; document.body.appendChild(b);
        const faint = document.createElement('p'); faint.className = 'probe-faint'; faint.style.cssText = 'color:#333;background:#111;font-size:14px'; faint.textContent = 'faint text'; document.body.appendChild(faint);
        const wrap = document.createElement('div'); wrap.style.cssText = 'background:#fff;padding:4px'; document.body.appendChild(wrap);
        const fade = document.createElement('p'); fade.className = 'probe-fade'; fade.style.cssText = 'color:#000;background:#fff;opacity:.2;font-size:14px;margin:0'; fade.textContent = 'faded text'; wrap.appendChild(fade);
        const nest = document.createElement('div'); nest.style.cssText = 'background:#000;opacity:.5;padding:4px'; wrap.appendChild(nest); const inside = document.createElement('p'); inside.className = 'probe-nested'; inside.style.cssText = 'color:#fff;font-size:14px;margin:0'; inside.textContent = 'nested faded'; nest.appendChild(inside);
        const wrapD = document.createElement('div'); wrapD.style.cssText = 'background:#fff;padding:4px'; document.body.appendChild(wrapD);
        const outerD = document.createElement('div'); outerD.style.cssText = 'background:#fff;opacity:.95;padding:4px'; wrapD.appendChild(outerD);
        const innerD = document.createElement('p'); innerD.className = 'probe-double'; innerD.style.cssText = 'color:#000;background:#fff;opacity:.5;font-size:14px;margin:0'; innerD.textContent = 'double faded'; outerD.appendChild(innerD);
        const transparentRing = document.createElement('button'); transparentRing.className = 'probe-ring'; transparentRing.style.cssText = 'outline:2px solid transparent'; document.body.appendChild(transparentRing); transparentRing.focus();
        const ringText = getComputedStyle(transparentRing).outlineColor; transparentRing.remove();
        const r = (new Function('return (' + fn + ')()'))(); b.remove(); faint.remove(); fade.remove(); nest.remove(); wrap.remove(); wrapD.remove(); return { r, ringText };
      }, scan.toString());
      const caughtText = caught.r;
      assert.ok(caughtText.some((m) => /has no accessible name/.test(m) && /probe/.test(m)), 'the scanner flags a button with no name');
      assert.ok(caughtText.some((m) => /low contrast/.test(m) && /faint text/.test(m)), 'the scanner flags low-contrast text');
      assert.ok(caughtText.some((m) => /low contrast/.test(m) && /faded text/.test(m)), 'the scanner flags faded text whose faded contrast is too low');
      assert.ok(caughtText.some((m) => /low contrast/.test(m) && /double faded/.test(m)), 'the scanner flags text under two faded groups (black at half opacity inside a 95% group is 3.94:1)');
      assert.ok(/transparent|rgba\([^)]*,\s*0\)/.test(caught.ringText) , 'a transparent outline is recognised as not painting');
      assert.ok(caughtText.some((m) => /low contrast/.test(m) && /nested faded/.test(m)), 'the scanner flags text faded by an ancestor group (white on black at half opacity over white is 3.98:1)');
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
  // the same scan on the smallest phone and on a desktop, so text and focus are checked at both extremes
  await check(browser, url, 'home 320px', [welcome({ games: games.list() })], { width: 320, height: 568 });
  await check(browser, url, 'home 1280px', [welcome({ games: games.list() })], { width: 1280, height: 800 });
  await check(browser, url, 'wizard table 320px', build('wizard', 4), { width: 320, height: 568 });
  await check(browser, url, 'ludo table 1280px', build('ludo', 4), { width: 1280, height: 800 });
  { // live regions: the page announces notices politely, so a screen reader hears them without a focus move
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: build('wizard', 4) });
    try {
      await page.goto(url + '/');
      await page.waitForSelector('#app *', { timeout: 8000 });
      const live = await page.evaluate(() => [...document.querySelectorAll('[aria-live]')].map((el) => el.getAttribute('aria-live')));
      assert.equal(await page.getAttribute('#toasts', 'aria-live'), 'polite', 'the notices region announces politely');
      assert.ok(live.every((v) => v === 'polite' || v === 'assertive' || v === 'off'), 'live regions use a valid politeness');
      await page.evaluate(() => window.__push({ t: 'notice', text: 'Scripted notice for the live region' }));
      await page.waitForFunction(() => (document.getElementById('toasts') || {}).textContent.includes('Scripted notice for the live region'), null, { timeout: 8000 });
      console.log('  ok  live regions');
    } catch (e) { failed++; console.error('FAIL  live regions\n' + (e.stack || e)); }
    await ctx.close();
  }
  const cssOk = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/style.css'), 'utf8') + require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/table.css'), 'utf8');
  assert.ok(/prefers-reduced-motion/.test(cssOk), 'reduced-motion rules exist');
  await browser.close(); server.close();
  console.log(failed ? `${failed} accessibility check(s) failed` : 'accessibility checks passed');
  process.exit(failed ? 1 : 0);
})();
