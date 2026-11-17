'use strict';
// Leaving a running game: with other people still playing, the page asks first (the leave counts as a loss) and sends
// nothing until the player confirms. Against bots only it leaves at once. Runs at a phone width.
const assert = require('node:assert/strict');
const games = require('../../games');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

const NAMES = ['Aarav', 'Bo', 'Charlotte', 'Dmitri'];
function messagesFor(humanIds) {
  const def = games.get('twentynine');
  const players = NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, avatar: '🧙' }));
  const g = def.create(players, Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default])), Math.random);
  const room = { code: 'ABCDEF', gameId: 'twentynine', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: NAMES.length, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, bot: !humanIds.includes(i === 0 ? 'me' : 'p' + i), avatar: '🧙', connected: true, ping: null, username: null })) };
  return [welcome({ id: 'me', name: NAMES[0], games: games.list() }), { t: 'state', room, view: g.view('me') }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    await test('with another person still playing, Leave asks first and sends nothing until confirmed', async () => {
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 393, height: 852 }, messages: messagesFor(['me', 'p1']) });
      try {
        await page.goto(url + '/');
        await page.waitForSelector('.wz-top', { timeout: 8000 });
        await page.evaluate(() => document.querySelector('[data-t9="leave"]').click());
        await page.waitForSelector('.overlay .sheet', { timeout: 4000 });
        const text = await page.evaluate(() => document.querySelector('.overlay .sheet').innerText);
        assert.ok(text.includes('Leave game?'), 'the question is shown');
        assert.ok(text.includes('counts as a loss'), 'the warning says the leave counts as a loss');
        assert.equal((await page.evaluate(() => window.__sent)).filter((m) => m.t === 'leave').length, 0, 'nothing is sent before the player confirms');
        await page.evaluate(() => document.querySelector('[data-modal-act="leaveGameConfirm"]').click());
        await page.waitForFunction(() => window.__sent.some((m) => m.t === 'leave'), null, { timeout: 4000 });
      } finally { await ctx.close(); }
    });

    for (const abandons of [false, true]) {
      await test(`a final leave prompt explains penalties and rejoining (abandons=${abandons})`, async () => {
        const messages = messagesFor(['me', 'p1']);
        messages[1].room.leaveInfo = { abandoned: false, pending: abandons ? ['p2'] : [], counts: { me: 2 } };
        const { page, ctx } = await scriptedPage(browser, { viewport: { width: 393, height: 852 }, messages });
        try {
          await page.goto(url + '/');
          await page.waitForSelector('.wz-top', { timeout: 8000 });
          await page.evaluate(() => document.querySelector('[data-t9="leave"]').click());
          await page.waitForSelector('.overlay .sheet', { timeout: 4000 });
          const text = await page.locator('.overlay .sheet').innerText();
          assert.ok(text.includes('non-final penalties are removed; final penalties still count'));
          assert.ok(text.includes('the penalty is final, and coming back inside the time window does not remove it'));
          assert.ok(text.includes('Once the game is abandoned, you cannot take your seat back'));
          assert.ok(!text.includes('nobody is penalised'));
          assert.equal((await page.evaluate(() => window.__sent)).filter((m) => m.t === 'leave').length, 0);
        } finally { await ctx.close(); }
      });
    }

    await test('against bots only, Leave does not ask and leaves at once', async () => {
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 393, height: 852 }, messages: messagesFor([]) });
      try {
        await page.goto(url + '/');
        await page.waitForSelector('.wz-top', { timeout: 8000 });
        await page.evaluate(() => document.querySelector('[data-t9="leave"]').click());
        await page.waitForFunction(() => window.__sent.some((m) => m.t === 'leave'), null, { timeout: 4000 });
        assert.equal(await page.evaluate(() => document.querySelector('.overlay .sheet') ? 1 : 0), 0, 'no question is shown');
      } finally { await ctx.close(); }
    });
  } catch (e) { failed++; console.error('FAIL  ' + e.message); }
  finally { await browser.close(); server.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
