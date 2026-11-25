'use strict';
// Shared table cues: a person sits down or leaves (bots are not announced), and the game starts from the lobby.
// The per-turn cue is covered by sound-consistency-ui.js.
const assert = require('assert');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`  ok  ${name}`); }
    catch (e) { failed += 1; console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
  };
  const open = async (msgs) => {
    const r = await scriptedPage(browser, { messages: msgs, viewport: { width: 390, height: 844 } });
    await r.page.goto(url + '/');
    await r.page.waitForSelector('#app *', { timeout: 8000 });
    await r.page.waitForTimeout(400);
    await r.page.evaluate(() => {
      window.__snd = [];
      const s = window.CardTable.sound;
      const real = s.play;
      s.play = (name, arg) => { window.__snd.push(name); return real(name, arg); };
    });
    return r;
  };
  const heard = (page) => page.evaluate(() => window.__snd.slice());
  const human = (id, name) => ({ id, name, bot: false, avatar: '🦊', connected: true, ping: null, username: null });

  await check('a person sits down at your table: one join cue; a repeated state plays nothing more', async () => {
    const msgs = tableMessages('colorclash', [{ name: 'Aarav' }, { name: 'Bo' }]);
    const { page, ctx } = await open(msgs);
    const withThird = JSON.parse(JSON.stringify(msgs[1]));
    withThird.room.members.push(human('p9', 'Cy'));
    await page.evaluate((m) => window.__push(m), withThird);
    await page.waitForTimeout(400);
    await page.evaluate((m) => window.__push(m), withThird); // the same state again
    await page.waitForTimeout(400);
    const got = await heard(page);
    await ctx.close();
    assert.equal(got.filter((n) => n === 'join').length, 1, `expected one join cue, got: ${got.join(' ') || 'none'}`);
  });

  await check('a person leaves your table: one leave cue', async () => {
    const msgs = tableMessages('colorclash', [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Cy' }]);
    const { page, ctx } = await open(msgs);
    const without = JSON.parse(JSON.stringify(msgs[1]));
    without.room.members = without.room.members.filter((m) => m.name !== 'Cy');
    await page.evaluate((m) => window.__push(m), without);
    await page.waitForTimeout(400);
    const got = await heard(page);
    await ctx.close();
    assert.equal(got.filter((n) => n === 'leave').length, 1, `expected one leave cue, got: ${got.join(' ') || 'none'}`);
  });

  await check('a bot taking a seat is not announced as someone joining', async () => {
    const msgs = tableMessages('colorclash', [{ name: 'Aarav' }, { name: 'Bo' }]);
    const { page, ctx } = await open(msgs);
    const withBot = JSON.parse(JSON.stringify(msgs[1]));
    withBot.room.members.push({ id: 'b1', name: 'Bot', bot: true, avatar: '🤖', connected: true, ping: null, username: null });
    await page.evaluate((m) => window.__push(m), withBot);
    await page.waitForTimeout(400);
    const got = await heard(page);
    await ctx.close();
    assert.equal(got.filter((n) => n === 'join').length, 0, `a bot should not play a join cue, got: ${got.join(' ') || 'none'}`);
  });

  await check('the game starts from the lobby: one start cue', async () => {
    const msgs = tableMessages('colorclash', [{ name: 'Aarav' }, { name: 'Bo' }]);
    const lobby = JSON.parse(JSON.stringify(msgs));
    lobby[1].room.status = 'lobby';
    const { page, ctx } = await open(lobby);
    const started = JSON.parse(JSON.stringify(msgs[1]));
    await page.evaluate((m) => window.__push(m), started);
    await page.waitForTimeout(400);
    const got = await heard(page);
    await ctx.close();
    assert.equal(got.filter((n) => n === 'start').length, 1, `expected one start cue, got: ${got.join(' ') || 'none'}`);
  });

  await browser.close(); server.close();
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nshared table sounds: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
