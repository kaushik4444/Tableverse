'use strict';
// Games load on demand: the home page downloads no game script, and a table downloads only its own game's script and stylesheet.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome, tableMessages } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } };

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const gameFiles = (reqs) => reqs.filter((u) => /\/games\/[^/]+\.(js|css)$/.test(u)).map((u) => u.replace(/.*\/games\//, ''));

  await test('the home page downloads no game script or game stylesheet', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: games.list() })] });
    const reqs = [];
    page.on('request', (r) => reqs.push(r.url()));
    await page.goto(url + '/');
    await page.waitForSelector('main, .page, .home, .tiles', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    assert.deepEqual(gameFiles(reqs), []);
    await ctx.close();
  });

  await test('a Wizard table downloads only the Wizard script, and renders', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('wizard', [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Chen' }, { name: 'Dana' }]), viewport: { width: 390, height: 844 } });
    const reqs = [];
    page.on('request', (r) => reqs.push(r.url()));
    await page.goto(url + '/');
    await page.waitForSelector('.wz', { timeout: 8000 });
    assert.deepEqual(gameFiles(reqs), ['wizard.js'], 'files: ' + gameFiles(reqs).join(', '));
    await ctx.close();
  });

  await test('a Chess table downloads its script and stylesheet, and renders the board', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('chess', [{ name: 'Aarav' }, { name: 'Bo' }]), viewport: { width: 390, height: 844 } });
    const reqs = [];
    page.on('request', (r) => reqs.push(r.url()));
    await page.goto(url + '/');
    await page.waitForSelector('.ch-board, .ch-square, [data-ch-sq]', { timeout: 8000 });
    assert.deepEqual(gameFiles(reqs).sort(), ['chess.css', 'chess.js']);
    await ctx.close();
  });

  // a lobby of the same game has no view, so a table's screen cannot be drawn from it
  const lobbyState = () => ({ t: 'state', view: null, room: {
    code: 'ABCDEF', gameId: 'chess', hostId: 'me', status: 'lobby', options: {}, visibility: 'public', seats: 1, min: 2, max: 2,
    seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: [{ id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true, ping: null, username: null }] } });
  const UNAVAILABLE = /This game is not available/;

  await test('a load that finishes after the player moved to a lobby of the same game leaves the lobby alone', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('chess', [{ name: 'Aarav' }, { name: 'Bo' }]), viewport: { width: 390, height: 844 } });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/games/chess.js', async (route) => { await gate; await route.continue(); });
    await page.goto(url + '/');
    await page.waitForFunction(() => /Loading the game/.test(document.body.innerText), null, { timeout: 8000 });
    await page.evaluate((m) => window.__push(m), lobbyState());
    await page.waitForFunction(() => !/Loading the game/.test(document.body.innerText), null, { timeout: 8000 });
    const scriptDone = page.waitForResponse((r) => /\/games\/chess\.js$/.test(r.url()), { timeout: 8000 });
    release();
    await scriptDone;
    // the load's callbacks run after the script response; give them a turn before checking the screen
    await page.waitForTimeout(400);
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), UNAVAILABLE, 'the lobby was replaced by the unavailable message');
    await ctx.close();
  });

  await test('a table still on screen is drawn once its game script has loaded', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('chess', [{ name: 'Aarav' }, { name: 'Bo' }]), viewport: { width: 390, height: 844 } });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/games/chess.js', async (route) => { await gate; await route.continue(); });
    await page.goto(url + '/');
    await page.waitForFunction(() => /Loading the game/.test(document.body.innerText), null, { timeout: 8000 });
    release();
    await page.waitForSelector('.ch-board, .ch-square, [data-ch-sq]', { timeout: 8000 });
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), UNAVAILABLE);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'game loader UI: all passed');
  process.exit(failed ? 1 : 0);
})();
