'use strict';
// The "who is ahead" crown is the same in every game: Wizard (score), Poker (chips, three or more players), 29 (team score),
// next to Go Fish, Snakes and Ladders, Ludo and Property Rivals which had it first. No crown on a tie or at the start.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo', 'Charlotte', 'Dmitri'].map((name) => ({ name }));

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (id, seats, mutate) => {
    const m = tableMessages(id, names.slice(0, seats)); mutate(m[1].view);
    const { page, ctx } = await scriptedPage(browser, { messages: m });
    await page.goto(url + '/'); await page.waitForSelector('.wz, .pk', { timeout: 8000 }); await page.waitForTimeout(150);
    return { page, ctx };
  };
  const crownOwner = (page) => page.evaluate(() => { const b = document.querySelector('.pseat .bdg.l'); return b ? b.closest('.pseat').dataset.pid : null; });

  await test('wizard: the highest score wears the crown; a tie or no points means no crown', async () => {
    const a = await open('wizard', 4, (v) => { v.players.forEach((p, i) => { p.score = [20, 50, 30, -10][i]; }); });
    assert.equal(await crownOwner(a.page), 'p1'); assert.match(await a.page.textContent('.pseat .bdg.l'), /Lead/); await a.ctx.close();
    const b = await open('wizard', 4, (v) => { v.players.forEach((p, i) => { p.score = [50, 50, 30, 0][i]; }); });
    assert.equal(await crownOwner(b.page), null, 'tied at the top'); await b.ctx.close();
    const c = await open('wizard', 4, (v) => { v.players.forEach((p) => { p.score = 0; }); });
    assert.equal(await crownOwner(c.page), null, 'nobody has scored'); await c.ctx.close();
  });

  await test('poker: the chip leader wears the crown with three or more players, and nobody heads-up', async () => {
    const a = await open('poker', 3, (v) => { v.players.forEach((p, i) => { p.chips = [900, 1400, 700][i]; p.bet = 0; p.out = false; }); });
    assert.equal(await crownOwner(a.page), 'p1'); await a.ctx.close();
    const b = await open('poker', 2, (v) => { v.players.forEach((p, i) => { p.chips = [900, 1400][i]; p.bet = 0; }); });
    assert.equal(await crownOwner(b.page), null, 'heads-up'); await b.ctx.close();
  });

  await test('29: the team that is ahead has the crown on its score box', async () => {
    const a = await open('twentynine', 4, (v) => { v.teamScore = [3, 1]; });
    const text = await a.page.textContent('.t29-strip');
    assert.equal((text.match(/👑/g) || []).length, 1, 'one crown'); await a.ctx.close();
    const b = await open('twentynine', 4, (v) => { v.teamScore = [2, 2]; });
    assert.equal((await b.page.textContent('.t29-strip')).includes('👑'), false, 'no crown on a tie'); await b.ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
