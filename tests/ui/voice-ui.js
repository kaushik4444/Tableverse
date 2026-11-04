'use strict';
// Table voice in a real browser: the microphone and speaker buttons in the lobby and in a game, who is in voice, and a REAL
// audio connection between two pages (Chromium's fake microphone) with the setup messages relayed the way the server does.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome, tableMessages } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 12000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(100); } }

const def = games.get('wizard');
const members = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }].map((m) => ({ ...m, bot: false, avatar: '🧙', connected: true, ping: null, username: null }));
const lobbyRoom = { code: 'ABCDEF', gameId: 'wizard', hostId: 'a', status: 'lobby', options: {}, visibility: 'public', seats: 4, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [], members };
const msgsFor = (id) => [welcome({ id, name: id === 'a' ? 'Ann' : 'Bo', games: games.list(), ice: [] }), { t: 'state', room: lobbyRoom, view: null }];

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'voice' || m.t === 'rtc'));

  await test('the lobby has a microphone and a speaker button; the mic joins voice and says so to the server', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: msgsFor('a') });
    await page.goto(url + '/');
    await page.waitForSelector('.code-card');
    assert.equal(await page.locator('.vc-mic').count(), 1);
    assert.equal(await page.locator('.vc-spk').count(), 1);
    assert.equal(await page.getAttribute('.vc-mic', 'aria-pressed'), 'false');
    await page.click('.vc-mic');
    await until(async () => (await sent(page)).some((m) => m.t === 'voice' && m.on === true), 'join message');
    const join = (await sent(page)).find((m) => m.t === 'voice');
    assert.equal(join.muted, false, 'the mic is live after joining with it');
    assert.equal(await page.getAttribute('.vc-mic', 'aria-pressed'), 'true');
    await page.click('.vc-mic'); // second tap mutes, it does not leave
    await until(async () => (await sent(page)).some((m) => m.t === 'voice' && m.muted === true), 'mute message');
    assert.equal(await page.getAttribute('.vc-mic', 'aria-pressed'), 'false');
    await ctx.close();
  });

  await test('the speaker joins as a listener without asking for the microphone', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: msgsFor('a') });
    await page.goto(url + '/');
    await page.waitForSelector('.code-card');
    await page.click('.vc-spk');
    await until(async () => (await sent(page)).some((m) => m.t === 'voice' && m.on === true), 'join message');
    assert.equal((await sent(page)).find((m) => m.t === 'voice').muted, true, 'listening only: muted');
    assert.equal(await page.getAttribute('.vc-spk', 'aria-pressed'), 'true');
    await page.click('.vc-spk');
    assert.equal(await page.getAttribute('.vc-spk', 'aria-pressed'), 'false', 'the second tap silences everyone');
    await ctx.close();
  });

  await test('people in voice get a little mic in the lobby, a muted one a crossed speaker', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: msgsFor('a') });
    await page.goto(url + '/');
    await page.waitForSelector('.code-card');
    await page.evaluate(() => window.__push({ t: 'voice', ids: [{ id: 'b', muted: false }] }));
    await page.waitForSelector('.seat[data-vid="b"][data-voice="on"]');
    await page.evaluate(() => window.__push({ t: 'voice', ids: [{ id: 'b', muted: true }] }));
    await page.waitForSelector('.seat[data-vid="b"][data-voice="muted"]');
    assert.equal(await page.locator('.seat[data-vid="a"][data-voice]').count(), 0, 'you are not in voice');
    await ctx.close();
  });

  await test('every game has the buttons in its toolbar, right after the reactions, before the menu', async () => {
    for (const id of ['wizard', 'gofish', 'ludo', 'snakesladders']) {
      const msgs = tableMessages(id, [{ name: 'Ann' }, { name: 'Bo' }, { name: 'Cy' }, { name: 'Di' }]);
      const { page, ctx } = await scriptedPage(browser, { messages: msgs, viewport: { width: 360, height: 640 } });
      await page.goto(url + '/');
      await page.waitForSelector('.wz-top .row, .ludo-tools');
      const order = await page.evaluate(() => [...document.querySelector('.wz-top > .row, .ludo-tools').children].map((c) => (c.classList.contains('chat-btn') ? 'chat' : c.dataset.act === 'emotes' ? 'emotes' : c.classList.contains('vc-mic') ? 'mic' : c.classList.contains('vc-spk') ? 'speaker' : c.classList.contains('tb-more-wrap') ? 'more' : 'leave')).join(','));
      assert.equal(order, 'chat,emotes,mic,speaker,more,leave', id);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `${id}: no sideways scroll`);
      await ctx.close();
    }
  });

  await test('two real pages talk to each other: audio flows both ways, and leaving closes it', async () => {
    const pa = await scriptedPage(browser, { messages: msgsFor('a') });
    const pb = await scriptedPage(browser, { messages: msgsFor('b') });
    const pages = { a: pa.page, b: pb.page };
    await Promise.all([pa.page.goto(url + '/'), pb.page.goto(url + '/')]);
    await Promise.all([pa.page.waitForSelector('.code-card'), pb.page.waitForSelector('.code-card')]);
    // a tiny stand-in for the server: the voice list, and setup messages passed to the person they are for
    const inVoice = new Map(); const seen = { a: 0, b: 0 };
    const pump = setInterval(async () => {
      for (const id of ['a', 'b']) {
        let all; try { all = await pages[id].evaluate(() => window.__sent.filter((m) => m.t === 'voice' || m.t === 'rtc')); } catch { return; }
        while (seen[id] < all.length) {
          const m = all[seen[id]++];
          if (m.t === 'voice') {
            if (m.on) inVoice.set(id, !!m.muted); else inVoice.delete(id);
            const ids = [...inVoice].map(([k, muted]) => ({ id: k, muted }));
            for (const p of Object.values(pages)) p.evaluate((list) => window.__push({ t: 'voice', ids: list }), ids).catch(() => {});
          } else if (m.t === 'rtc' && inVoice.has(m.to)) pages[m.to].evaluate((x) => window.__push(x), { t: 'rtc', from: id, data: m.data }).catch(() => {});
        }
      }
    }, 40);
    try {
      await pa.page.click('.vc-mic');
      await pb.page.click('.vc-mic');
      for (const id of ['a', 'b']) {
        await until(() => pages[id].evaluate(() => { const au = document.querySelector('audio[data-voice-from]'); return !!au && !!au.srcObject && au.srcObject.getAudioTracks().length === 1; }), `${id} receives audio from the other`, 20000);
      }
      assert.equal(await pa.page.locator('.seat[data-vid="b"][data-voice="on"]').count(), 1, 'Ann sees Bo in voice');
      // the fake microphone beeps, so the other side should see a speaking ring at some point
      await until(() => pa.page.locator('.seat[data-vid="b"].speaking').count(), 'Ann sees Bo speaking', 15000).catch(() => { throw new Error('no speaking ring appeared for the fake microphone'); });
      await pb.page.click('.vc-mic'); await pb.page.click('.vc-mic'); // mute, unmute: still connected
      assert.equal(await pb.page.locator('audio[data-voice-from]').count(), 1);
      await pb.page.evaluate(() => document.querySelector('.vc-spk').click()); // Bo silences everyone
      assert.equal(await pb.page.evaluate(() => document.querySelector('audio[data-voice-from]').muted), true, 'silenced');
      await pb.page.evaluate(() => document.querySelector('.vc-spk').click());
      assert.equal(await pb.page.evaluate(() => document.querySelector('audio[data-voice-from]').muted), false, 'heard again');
      await pa.page.evaluate(() => window.__push({ t: 'left' })); // Ann leaves the table
      await pa.page.waitForSelector('.game-grid, .home-section', { timeout: 8000 }).catch(() => {});
      assert.equal(await pa.page.locator('audio[data-voice-from]').count(), 0, 'Ann has no audio connection left');
    } finally { clearInterval(pump); await pa.ctx.close(); await pb.ctx.close(); }
  });

  await browser.close(); server.close();
  console.log(`\nvoice UI: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
