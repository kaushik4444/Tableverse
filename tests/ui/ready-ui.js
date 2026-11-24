'use strict';
// The round summaries of Wizard, Twenty-Nine and Poker: their button is Ready, and it sends the ready message (the server
// starts the next round once everybody has pressed it). The state is real: the engine is driven by its bots to the summary.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk, closeOpenContexts } = require('./harness');
const { chromium } = loadPlaywright();
const games = require('../../games');

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const people = (n) => Array.from({ length: n }, (_, i) => ({ name: ['Ann', 'Bo', 'Cy', 'Di', 'Ed'][i] }));

/** The table at a given phase, reached by letting the engine's bots play (the viewer is seat 0, id "me"). */
function atPhase(gameId, n, phase) {
  const def = games.get(gameId);
  const extras = people(n);
  const ids = extras.map((x, i) => (i === 0 ? 'me' : 'p' + i));
  const options = Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default]));
  let a = 7; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(extras.map((x, i) => ({ id: ids[i], name: x.name, avatar: '🧙' })), options, rng);
  for (let i = 0; i < 20000; i++) {
    if (g.view('me').phase === phase) return { g, extras };
    const auto = typeof g.autoAction === 'function' ? g.autoAction() : null;
    if (auto && auto.type === 'continue') { g.act(null, auto); continue; }
    const id = g.awaiting()[0];
    if (!id) break;
    g.act(id, g.botAction(id));
  }
  throw new Error(`${gameId} never reached ${phase}`);
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const cases = [
    ['wizard', 3, 'roundEnd', '[data-ready-here] [data-act="readyUp"]', 'the Wizard round summary'],
    ['twentynine', 4, 'handEnd', '[data-ready-here] [data-act="readyUp"]', 'the Twenty-Nine hand summary'],
    ['poker', 3, 'handEnd', '[data-ready-here] [data-act="readyUp"]', 'the Poker hand summary'],
    ['stagerummy', 4, 'roundEnd', '[data-ready-here] [data-act="readyUp"]', 'the Stage 10 round summary'],
    ['penaltyrows', 4, 'roundEnd', '[data-ready-here] [data-act="readyUp"]', 'the Take 5 round summary'],
    ['colorclash', 4, 'roundEnd', '[data-ready-here] [data-act="readyUp"]', 'the Color Clash round summary'],
    ['hiddenminers', 4, 'roundEnd', '[data-ready-here] [data-act="readyUp"]', 'the Hidden Miners round summary'],
  ];
  for (const [gameId, n, phase, selector, label] of cases) {
    await test(`${label}: its button is Ready and sends the ready message`, async () => {
      const { g, extras } = atPhase(gameId, n, phase);
      // the server opens the gate at a round boundary: until everybody presses Ready, the summary is waiting for them
      const ids = extras.map((x, i) => (i === 0 ? 'me' : 'p' + i));
      const m = tableMessages(gameId, extras, { roomExtra: { status: 'playing', gate: { ready: [], waiting: ids } } });
      m[1].view = g.view('me');
      const { page, ctx } = await scriptedPage(browser, { messages: m, viewport: { width: 393, height: 852 } });
      await page.goto(url + '/');
      await page.waitForSelector(selector, { timeout: 8000 });
      assert.match(await page.textContent(selector), /Ready/, 'the button says Ready');
      await page.click(selector);
      const ready = await page.evaluate(() => window.__sent.filter((x) => x.t === 'ready').length);
      assert.equal(ready, 1, 'one ready message was sent');
      const acts = await page.evaluate(() => window.__sent.filter((x) => x.t === 'act').length);
      assert.equal(acts, 0, 'no game action is sent in its place');
      await ctx.close();
    });
  }
  await closeOpenContexts();
  await browser.close();
  server.close();
  console.log(`\n${passed} ready UI tests passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
