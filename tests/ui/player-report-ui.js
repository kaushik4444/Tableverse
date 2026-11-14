'use strict';
// A registered player can be reported from their table card (not only from a chat message). The card offers a reason
// menu, sends one report for the chosen reason, and never offers it for a bot or for the viewer.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, tableMessages, welcome } = require('./harness');

const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 12000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(100); } }

// Seat 0 is the viewer (signed in as aarav); Bo is a registered player; Robo is a bot.
const extras = [{ name: 'Aarav', username: 'aarav' }, { id: 'b', name: 'Bo', username: 'bob' }, { id: 'bot1', name: 'Robo', bot: true }];

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();

  /** A signed-in table with Bo (a registered player) and a bot at the table. */
  async function openTable() {
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('wizard', extras) });
    await page.goto(url + '/');
    await page.waitForSelector('.pseat[data-pid="b"]', { timeout: 8000 });
    return { page, ctx };
  }

  /** Opens a seat's card and waits for it to be drawn for that player (a registered player's card loads its profile first). */
  async function openCard(page, pid, { loaded = pid !== 'bot1' } = {}) {
    await page.click(`.pseat[data-pid="${pid}"]`);
    await page.waitForSelector(`#modal-overlay .modal-body[data-card="${pid}"]`);
    if (loaded) await page.waitForSelector(`#modal-overlay .modal-body[data-card="${pid}"] [data-modal-act="cardReport"]`);
  }

  await test('a registered player’s card offers Report, and choosing a reason sends one report for that player', async () => {
    const { page, ctx } = await openTable();
    await openCard(page, 'b');
    await page.click('[data-modal-act="cardReport"]');
    await page.waitForSelector('.report-menu');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.reason), 'harassment', 'opening the menu focuses its first reason');
    await page.click('[data-modal-act="cardReportSend"][data-reason="spam"]');
    await until(async () => (await page.evaluate(() => window.__sent.filter((m) => m.t === 'reportPlayer'))).length === 1, 'report sent');
    const [sent] = await page.evaluate(() => window.__sent.filter((m) => m.t === 'reportPlayer'));
    assert.deepEqual(sent, { t: 'reportPlayer', id: 'b', reason: 'spam' });
    assert.equal(await page.locator('.report-menu').count(), 0, 'the reason menu closes after sending');
    await ctx.close();
  });

  await test('the reason menu can be cancelled, and cancelling sends nothing', async () => {
    const { page, ctx } = await openTable();
    await openCard(page, 'b');
    await page.click('[data-modal-act="cardReport"]');
    await page.waitForSelector('.report-menu');
    await page.click('.report-menu [data-modal-act="cardReport"]'); // the menu's Cancel
    assert.equal(await page.locator('.report-menu').count(), 0, 'Cancel closes the menu');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.modalAct), 'cardReport', 'Cancel returns focus to Report');
    assert.equal(await page.evaluate(() => window.__sent.filter((m) => m.t === 'reportPlayer').length), 0, 'nothing was sent');
    await ctx.close();
  });

  await test('a bot’s card does not offer Report', async () => {
    const { page, ctx } = await openTable();
    await openCard(page, 'bot1');
    assert.equal(await page.locator('[data-modal-act="cardReport"]').count(), 0);
    await ctx.close();
  });

  // ---- another player's page: Block / Unblock and Report, by username (the page never holds an id)
  const profileApi = { 'GET /api/players/bob': () => ({ ok: true, profile: { username: 'bob', displayName: 'Bo', avatar: '🦊', joinedAt: '2026-01-01T00:00:00.000Z', played: 3, wins: 1, winRate: 33, blockedByMe: false } }) };
  const pageFor = async (srv, hash, { socket = true } = {}) => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: [{ id: 'wizard', name: 'Wizard', icon: '🧙', accent: '#8a5cf6', seats: { min: 3, max: 6 }, options: [], rules: [] }] })] });
    // Open home first, then navigate in-app the way a tap does (pushState + popstate). A deep link can race the
    // startup route, before the welcome arrives, so it is not used here.
    await page.goto(srv + '/');
    if (socket) { await page.waitForFunction(() => window.__sent.some((m) => m.t === 'hello')); await page.waitForTimeout(400); } // the welcome follows the hello
    else await page.waitForTimeout(600);
    await page.evaluate((h) => { history.pushState(null, '', h); dispatchEvent(new PopStateEvent('popstate')); }, hash);
    await page.waitForSelector('.pp-head');
    return { page, ctx };
  };

  await test('a signed-in viewer’s page for another player offers Block and Report, sent by username', async () => {
    const srv = await serve({ 'GET /api/auth/session': () => sessionOk(), ...profileApi });
    const { page, ctx } = await pageFor(srv.url, '/#u/bob');
    await page.click('[data-act="playerBlock"]');
    await page.waitForSelector('[data-act="playerUnblock"]');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'playerUnblock', 'focus stays on the button that replaced Block');
    const blocks = await page.evaluate(() => window.__sent.filter((m) => m.t === 'block'));
    assert.deepEqual(blocks, [{ t: 'block', username: 'bob' }]);
    await page.click('[data-act="playerReport"]');
    await page.waitForSelector('.report-menu');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.reason), 'harassment', 'opening the menu focuses its first reason');
    await page.click('[data-act="playerReportSend"][data-reason="spam"]');
    await page.waitForSelector('[data-act="playerReport"]');
    const reports = await page.evaluate(() => window.__sent.filter((m) => m.t === 'reportPlayer'));
    assert.deepEqual(reports, [{ t: 'reportPlayer', username: 'bob', reason: 'spam' }]);
    assert.equal(await page.locator('.report-menu').count(), 0, 'the menu closes after sending');
    await ctx.close(); await srv.server.close();
  });

  await test('a blocked player’s page offers Unblock, which sends the same username', async () => {
    const srv = await serve({ 'GET /api/auth/session': () => sessionOk(), 'GET /api/players/bob': () => ({ ok: true, profile: { username: 'bob', displayName: 'Bo', avatar: '🦊', joinedAt: '2026-01-01T00:00:00.000Z', played: 3, wins: 1, winRate: 33, blockedByMe: true } }) });
    const { page, ctx } = await pageFor(srv.url, '/#u/bob');
    await page.click('[data-act="playerUnblock"]');
    await page.waitForSelector('[data-act="playerBlock"]');
    assert.deepEqual(await page.evaluate(() => window.__sent.filter((m) => m.t === 'unblock')), [{ t: 'unblock', username: 'bob' }]);
    await ctx.close(); await srv.server.close();
  });

  await test('a player the viewer has not blocked gets Block, and never Unblock', async () => {
    const srv = await serve({ 'GET /api/auth/session': () => sessionOk(), 'GET /api/players/bob': () => ({ ok: true, profile: { username: 'bob', displayName: 'Bo', avatar: '🦊', joinedAt: '2026-01-01T00:00:00.000Z', played: 3, wins: 1, winRate: 33, blockedByMe: false } }) });
    const { page, ctx } = await pageFor(srv.url, '/#u/bob');
    assert.equal(await page.locator('[data-act="playerUnblock"]').count(), 0, 'no Unblock when the viewer has not blocked them');
    assert.equal(await page.locator('[data-act="playerBlock"]').count(), 1, 'the viewer can still block them');
    await ctx.close(); await srv.server.close();
  });

  // The page shows a block at once; the server's answer (the new list, or an error) puts it right if the block was refused.
  await test('a refused block goes back to Block, and a confirmed block stays Unblock', async () => {
    let blockedByMe = false; // what the server's profile answer says
    const srv = await serve({ 'GET /api/auth/session': () => sessionOk(), 'GET /api/players/bob': () => ({ ok: true, profile: { username: 'bob', displayName: 'Bo', avatar: '🦊', joinedAt: '2026-01-01T00:00:00.000Z', played: 3, wins: 1, winRate: 33, blockedByMe } }) });
    const { page, ctx } = await pageFor(srv.url, '/#u/bob');
    await page.click('[data-act="playerBlock"]');
    await page.waitForSelector('[data-act="playerUnblock"]'); // shown at once
    await page.evaluate(() => window.__push({ t: 'error', message: 'Slow down a little' })); // the server refused it
    await page.waitForSelector('[data-act="playerBlock"]', { timeout: 4000 });
    assert.equal(await page.locator('[data-act="playerUnblock"]').count(), 0, 'a refused block is not shown as a block');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.act), 'playerBlock', 'keyboard focus stays on the block control after the correction');
    blockedByMe = true; // now the server accepts it
    await page.click('[data-act="playerBlock"]');
    await page.evaluate(() => window.__push({ t: 'blocks', blocks: [{ id: 'x', name: 'Bo' }] })); // and sends the new list
    await page.waitForTimeout(400);
    assert.equal(await page.locator('[data-act="playerUnblock"]').count(), 1, 'a confirmed block stays shown');
    await ctx.close(); await srv.server.close();
  });

  await test('a refused block goes back to the last confirmed state even when the profile cannot be fetched again', async () => {
    let down = false; // the profile endpoint fails after the first load
    const srv = await serve({ 'GET /api/auth/session': () => sessionOk(), 'GET /api/players/bob': () => (down ? { __status: 503, body: { ok: false, error: 'down' } } : { ok: true, profile: { username: 'bob', displayName: 'Bo', avatar: '🦊', joinedAt: '2026-01-01T00:00:00.000Z', played: 3, wins: 1, winRate: 33, blockedByMe: false } }) });
    const { page, ctx } = await pageFor(srv.url, '/#u/bob');
    down = true;
    await page.click('[data-act="playerBlock"]');
    await page.waitForSelector('[data-act="playerUnblock"]');
    await page.evaluate(() => window.__push({ t: 'error', message: 'You can block up to 100 accounts.' }));
    await page.waitForSelector('[data-act="playerBlock"]', { timeout: 4000 });
    assert.equal(await page.locator('[data-act="playerUnblock"]').count(), 0, 'the refused block is not left on screen');
    await ctx.close(); await srv.server.close();
  });

  // A block or unblock the server confirmed becomes the baseline even when the profile check afterwards cannot be made.
  await test('a confirmed unblock is the rollback state for a later refused block, even if the profile cannot be fetched', async () => {
    let down = false;
    const profile = (blockedByMe) => ({ ok: true, profile: { username: 'bob', displayName: 'Bo', avatar: '🦊', joinedAt: '2026-01-01T00:00:00.000Z', played: 3, wins: 1, winRate: 33, blockedByMe } });
    const srv = await serve({ 'GET /api/auth/session': () => sessionOk(), 'GET /api/players/bob': () => (down ? { __status: 503, body: { ok: false, error: 'down' } } : profile(true)) }); // starts blocked
    const { page, ctx } = await pageFor(srv.url, '/#u/bob');
    try {
      down = true; // from here no profile check can be made
      await page.click('[data-act="playerUnblock"]');
      await page.waitForSelector('[data-act="playerBlock"]'); // shown at once
      await page.evaluate(() => window.__push({ t: 'blocks', blocks: [] })); // the server confirms the unblock
      await page.waitForTimeout(400);
      await page.click('[data-act="playerBlock"]');
      await page.waitForSelector('[data-act="playerUnblock"]'); // shown at once
      await page.evaluate(() => window.__push({ t: 'error', message: 'Slow down a little' })); // the block was refused
      await page.waitForSelector('[data-act="playerBlock"]', { timeout: 4000 }); // back to the confirmed state: not blocked
      assert.equal(await page.locator('[data-act="playerUnblock"]').count(), 0, 'the refused block is not shown, and the page does not fall back to the old blocked state');
    } finally { await ctx.close(); await srv.server.close(); }
  });

  // An older profile answer that arrives after a newer one must not change what the page falls back to.
  // The checks are answered through request interception: the browser's cache would otherwise make the second identical
  // request wait for the first one, and the order could not be controlled.
  await test('a stale profile answer cannot change the confirmed block state used when a later check fails', async () => {
    const profile = (blockedByMe) => ({ ok: true, profile: { username: 'bob', displayName: 'Bo', avatar: '🦊', joinedAt: '2026-01-01T00:00:00.000Z', played: 3, wins: 1, winRate: 33, blockedByMe } });
    const srv = await serve({ 'GET /api/auth/session': () => sessionOk(), ...profileApi }); // the first load: not blocked
    const { page, ctx } = await pageFor(srv.url, '/#u/bob');
    let n = 0; let down = false; let release;
    const held = new Promise((r) => { release = r; });
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    try {
      await page.route('**/api/players/bob', async (route) => {
        const k = ++n;
        if (k === 1) { await held; return json(route, profile(false)); } // an older check, answered late with an old value
        if (k === 2) return json(route, profile(true)); // a newer check confirms the block
        return down ? json(route, { ok: false, error: 'down' }, 503) : json(route, profile(true));
      });
      await page.click('[data-act="playerBlock"]');
      await page.waitForSelector('[data-act="playerUnblock"]');
      await page.evaluate(() => window.__push({ t: 'blocks', blocks: [{ id: 'x', name: 'Bo' }] })); // check 1, held
      await until(() => n >= 1, 'the older check to start');
      await page.evaluate(() => window.__push({ t: 'blocks', blocks: [{ id: 'x', name: 'Bo' }] })); // check 2, answered at once
      await until(() => n >= 2, 'the newer check to start');
      await page.waitForTimeout(300);
      release(); // the older, stale answer (not blocked) arrives now
      await page.waitForTimeout(300);
      down = true; // from here the profile cannot be fetched again
      await page.click('[data-act="playerUnblock"]');
      await page.waitForSelector('[data-act="playerBlock"]'); // shown at once
      await page.evaluate(() => window.__push({ t: 'error', message: 'Slow down a little' })); // the unblock was refused
      await page.waitForSelector('[data-act="playerUnblock"]', { timeout: 4000 }); // back to what the server last confirmed: blocked
      assert.equal(await page.locator('[data-act="playerBlock"]').count(), 0, 'the stale answer did not make the page fall back to not blocked');
    } finally { release(); await ctx.close(); await srv.server.close(); }
  });

  await test('a guest does not see Block or Report on another player’s page', async () => {
    const srv = await serve({ 'GET /api/auth/session': () => ({ ok: true, authenticated: false }), ...profileApi });
    const { page, ctx } = await pageFor(srv.url, '/#u/bob', { socket: false });
    assert.equal(await page.locator('[data-act="playerBlock"], [data-act="playerReport"]').count(), 0);
    await ctx.close(); await srv.server.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
