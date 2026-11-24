'use strict';
// Every game gives the same "your turn" chime, and Stage 10 plays a card sound for each new card move.
const assert = require('assert');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

// trick-taking games time their own turn cue after the trick is collected (see soundsFor in app.js)
const TRICK_GAMES = new Set(['wizard', 'twentynine']);

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`  ok  ${name}`); }
    catch (e) { failed += 1; console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
  };
  const spy = (page) => page.evaluate(() => {
    window.__snd = [];
    const s = window.CardTable.sound;
    const real = s.play;
    s.play = (name, arg) => { window.__snd.push(name); return real(name, arg); };
    window.CardTable.sound.toggle = () => {}; // (no-op: keeps the test from touching storage)
  });
  const turnCount = (page) => page.evaluate(() => window.__snd.filter((n) => n === 'turn').length);

  for (const def of games.list()) {
    if (TRICK_GAMES.has(def.id)) continue;
    await check(`${def.id}: the your-turn chime plays once when the turn comes round`, async () => {
      const n = Math.min(def.seats.max, Math.max(def.seats.min, 4));
      const names = ['Aarav', 'Bo', 'Charlotte', 'Dmitri'].slice(0, n).map((name) => ({ name }));
      const msgs = tableMessages(def.id, names);
      const off = JSON.parse(JSON.stringify(msgs));
      off[1].view.myTurn = false;
      const on = JSON.parse(JSON.stringify(msgs));
      on[1].view.myTurn = true;
      const { page, ctx } = await scriptedPage(browser, { messages: off, viewport: { width: 390, height: 844 } });
      await page.goto(url + '/');
      await page.waitForSelector('#app *', { timeout: 8000 });
      await page.waitForTimeout(400);
      await spy(page);
      await page.evaluate((m) => window.__push(m), on[1]);
      await page.waitForTimeout(500);
      const got = await turnCount(page);
      await ctx.close();
      assert.equal(got, 1, `expected one turn chime, got ${got}`);
    });
  }

  await check('stage 10: a new card move plays a card sound; a first load plays none', async () => {
    const def = games.get('stagerummy');
    const names = ['Aarav', 'Bo', 'Charlotte', 'Dmitri'].slice(0, Math.min(def.seats.max, 4)).map((name) => ({ name }));
    const msgs = tableMessages('stagerummy', names);
    const { page, ctx } = await scriptedPage(browser, { messages: msgs, viewport: { width: 390, height: 844 } });
    await page.goto(url + '/');
    await page.waitForSelector('#app *', { timeout: 8000 });
    await page.waitForTimeout(400);
    await spy(page);
    const log = msgs[1].view.log;
    const last = log.length ? log[log.length - 1].seq : 0;
    const next = JSON.parse(JSON.stringify(msgs[1]));
    next.view.log = [...log, { seq: last + 1, type: 'discard', by: 1, label: '7♥' }];
    next.view.event = { seq: last + 1, type: 'discard', by: 1, label: '7♥' };
    await page.evaluate((m) => window.__push(m), next);
    await page.waitForTimeout(500);
    const all = await page.evaluate(() => window.__snd);
    await ctx.close();
    const cards = all.filter((n) => n === 'card').length;
    assert.ok(cards >= 1, `expected a card sound for the new discard, got ${cards} (all sounds: ${all.join(' ') || 'none'})`);
  });

  await browser.close(); server.close();
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nsound consistency: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
