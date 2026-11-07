'use strict';
// The table chat report menu must survive chat updates: an incoming message redraws the chat list, but the open reason
// menu and the keyboard focus on it stay where they were, and sending a report closes the menu.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 12000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(100); } }

const def = games.get('wizard');
const members = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }].map((m) => ({ ...m, bot: false, avatar: '🧙', connected: true, ping: null, username: null }));
const lobbyRoom = { code: 'ABCDEF', gameId: 'wizard', hostId: 'a', status: 'lobby', options: {}, visibility: 'public', seats: 4, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [], members };
const boMessage = () => ({ id: 'b', name: 'Bo', text: 'first message', mid: crypto.randomUUID() });
const newer = () => ({ id: 'b', name: 'Bo', text: 'a newer message arrives', mid: crypto.randomUUID() });

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();

  /** A table with chat open and one message from Bo, as the server would send it. */
  async function openTableChat() {
    const first = boMessage();
    const { page, ctx } = await scriptedPage(browser, {
      messages: [
        welcome({ id: 'a', name: 'Ann', games: games.list(), ice: [] }),
        { t: 'state', room: lobbyRoom, view: null },
        { t: 'chatlog', messages: [first] },
      ],
    });
    await page.goto(url + '/');
    await page.waitForSelector('.code-card');
    await page.click('.chat-btn');
    await page.waitForSelector('#chat-list .msg');
    return { page, ctx, first };
  }

  await test('an incoming chat message keeps an open report menu and the focus on its reason button', async () => {
    const { page, ctx, first } = await openTableChat();
    await page.click('[data-mod="report-open"]');
    await page.waitForSelector('.report-menu');
    await page.focus('[data-mod="report-send"][data-reason="spam"]');
    await page.evaluate((m) => window.__push({ t: 'chat', m }), newer());
    await until(() => page.evaluate(() => document.querySelectorAll('#chat-list .msg').length === 2), 'the new message is drawn');
    assert.equal(await page.locator('.report-menu').count(), 1, 'the menu is still open after the redraw');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.reason), 'spam', 'focus is on the same reason');
    assert.ok(first.mid, 'the first message carried its id');
    await ctx.close();
  });

  // Regression: two Block buttons for the same author shared one focus signature, so a redraw could move focus to the
  // wrong message's control. Each button carries its message id, so focus stays on the one that had it.
  await test('focus stays on the Block button of the same message when another message from that author arrives', async () => {
    const { page, ctx } = await openTableChat();
    await page.evaluate((m) => window.__push({ t: 'chat', m }), newer());
    await until(() => page.evaluate(() => document.querySelectorAll('#chat-list .msg').length === 2), 'the second message is drawn');
    await page.locator('[data-mod="block"]').nth(1).focus();
    const expected = await page.evaluate(() => document.activeElement.dataset.mid);
    await page.evaluate((m) => window.__push({ t: 'chat', m }), { id: 'b', name: 'Bo', text: 'a third message', mid: crypto.randomUUID() });
    await until(() => page.evaluate(() => document.querySelectorAll('#chat-list .msg').length === 3), 'the third message is drawn');
    const after = await page.evaluate(() => document.activeElement && document.activeElement.dataset.mid);
    assert.ok(expected, 'the focused Block button carries its message id');
    assert.equal(after, expected, 'focus is still on the same message\'s Block button');
    await ctx.close();
  });

  await test('focused moderation controls stay visible when incoming chat overflows the list', async () => {
    const { page, ctx } = await openTableChat();
    await page.evaluate(() => {
      for (let i = 0; i < 35; i++) window.__push({ t: 'chat', m: { id: 'b', name: 'Bo', text: 'overflow message ' + i, mid: crypto.randomUUID() } });
    });
    await until(() => page.locator('#chat-list .msg').count().then((n) => n === 36), 'overflow history');
    const control = page.locator('[data-mod="block"]').nth(20);
    await control.scrollIntoViewIfNeeded();
    await control.focus();
    const before = await page.evaluate(() => ({ mid: document.activeElement.dataset.mid, scrollTop: document.getElementById('chat-list').scrollTop }));
    await page.evaluate((m) => window.__push({ t: 'chat', m }), newer());
    await until(() => page.locator('#chat-list .msg').count().then((n) => n === 37), 'overflow redraw');
    const after = await page.evaluate(() => {
      const list = document.getElementById('chat-list');
      const rect = document.activeElement.getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      return { mid: document.activeElement.dataset.mid, scrollTop: list.scrollTop, visible: rect.top >= bounds.top && rect.bottom <= bounds.bottom };
    });
    assert.equal(after.mid, before.mid, 'the same moderation control retains focus');
    assert.equal(after.scrollTop, before.scrollTop, 'chat scroll position is preserved');
    assert.equal(after.visible, true, 'the focused control remains inside the visible chat area');
    await ctx.close();
  });

  await test('the Block control says it hides table chat only, in its label and its tooltip', async () => {
    const { page, ctx } = await openTableChat();
    const block = page.locator('[data-mod="block"]').first();
    assert.equal((await block.textContent()).trim(), 'Block chat');
    assert.match(await block.getAttribute('title'), /table chat/i);
    assert.match(await block.getAttribute('aria-label'), /Block chat from Bo/);
    await ctx.close();
  });

  await test('choosing a reason sends one report for that message and closes the menu', async () => {
    const { page, ctx, first } = await openTableChat();
    await page.click('[data-mod="report-open"]');
    await page.waitForSelector('.report-menu');
    await page.click('[data-mod="report-send"][data-reason="harassment"]');
    await until(async () => (await page.evaluate(() => window.__sent.filter((m) => m.t === 'report'))).length === 1, 'report sent');
    const [sent] = await page.evaluate(() => window.__sent.filter((m) => m.t === 'report'));
    assert.equal(sent.messageId, first.mid);
    assert.equal(sent.reason, 'harassment');
    assert.equal(await page.locator('.report-menu').count(), 0, 'the menu closes after sending');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.mod), 'report-open', 'focus returns to the Report button');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.mid), first.mid, 'of the same message');
    await ctx.close();
  });

  await test('the report button toggles its menu, and closing the chat closes the menu', async () => {
    const { page, ctx } = await openTableChat();
    await page.click('[data-mod="report-open"]');
    await page.waitForSelector('.report-menu');
    await page.click('[data-mod="report-open"]');
    assert.equal(await page.locator('.report-menu').count(), 0, 'a second tap closes it');
    await page.click('[data-mod="report-open"]');
    await page.waitForSelector('.report-menu');
    await page.click('[data-chat="close"]');
    await page.click('.chat-btn');
    await page.waitForSelector('#chat-list .msg');
    assert.equal(await page.locator('.report-menu').count(), 0, 'reopening the chat starts with no menu');
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
