'use strict';
// Stage 10 in a real browser: drawing, assigning cards to the stage's groups, laying down, discarding, hitting, game over, narrow phone.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));
const card = (id) => { const c = require('../../games/stagerummy/engine').makeCard(id); return { id: c.id, k: c.k, c: c.c, v: c.v }; };
const expandedGroups = () => [
  { kind: 'set', num: 5, cards: [4, 28, 52].map(card) },
  { kind: 'run', lo: 6, hi: 12, cards: [5, 6, 7, 8, 9, 10, 11].map(card) },
];

/** Messages where it is my turn in the given phase, with a chosen hand. */
function scene(phase, handIds, tweak) {
  const msgs = tableMessages('stagerummy', four);
  const v = msgs[1].view;
  v.me = 0; v.turn = 0; v.myTurn = true; v.phase = phase;
  v.hand = handIds.map(card);
  if (tweak) tweak(v);
  return msgs;
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.sr', { timeout: 8000 });
    return { page, ctx };
  };

  await test('draw phase: stock and discard are buttons and send the draw', async () => {
    const { page, ctx } = await open(scene('draw', [4, 5, 6]));
    await page.click('[data-sr="draw"][data-from="stock"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'draw', from: 'stock' });
    await ctx.close();
  });

  await test('a skip on the discard pile cannot be taken', async () => {
    const { page, ctx } = await open(scene('draw', [4, 5, 6], (v) => { v.discardTop = card(104); }));
    assert.equal(await page.isDisabled('[data-sr="draw"][data-from="discard"]'), true);
    await ctx.close();
  });

  await test('the Stages sheet keeps Tab inside it', async () => {
    const { page, ctx } = await open(scene('draw', [4, 5, 6]), { width: 1280, height: 860 });
    if (!(await page.isVisible('[data-sr="phases"]'))) await page.click('.tb-more-btn'); // the toolbar folds into a menu on smaller screens
    await page.click('[data-sr="phases"]');
    await page.waitForSelector('[aria-labelledby="sr-phases-title"]');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.sr), 'closePhases', 'Tab stays on Close');
    await page.keyboard.press('Enter'); // Close already has focus; the mouse target at this size is outside the sheet, so keys are the reliable path
    await page.waitForFunction(() => { const a = document.activeElement; return a && (a.dataset.sr === 'phases' || a.classList.contains('tb-more-btn')); }, null, { timeout: 3000 }); // focus goes back to the Phases button, or to the menu that holds it
    await ctx.close();
  });

  await test('stage 1: select cards, add them to the two groups, lay down sends both groups', async () => {
    // 5 red/blue/green (ids 4, 28, 52) as the set; red 2,3,4 (ids 1,2,3) as the run
    const { page, ctx } = await open(scene('play', [4, 28, 52, 1, 2, 3, 80, 90]));
    assert.equal(await page.isDisabled('[data-sr="lay"]'), true);
    for (const id of [4, 28, 52]) await page.click(`.sr-hand [data-id="${id}"]`);
    await page.click('[data-sr="assign"][data-group="0"]');
    for (const id of [1, 2, 3]) await page.click(`.sr-hand [data-id="${id}"]`);
    await page.click('[data-sr="assign"][data-group="1"]');
    assert.equal(await page.isDisabled('[data-sr="lay"]'), false);
    await page.click('[data-sr="lay"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'lay', groups: [[4, 28, 52], [1, 2, 3]] });
    await ctx.close();
  });

  await test('a card put in a group can be taken back out', async () => {
    const { page, ctx } = await open(scene('play', [4, 28, 52, 1, 2, 3]));
    await page.click('.sr-hand [data-id="4"]');
    await page.click('[data-sr="assign"][data-group="0"]');
    assert.equal(await page.locator('.sr-tcards [data-id="4"]').count(), 1);
    await page.click('.sr-tcards [data-id="4"]');
    assert.equal(await page.locator('.sr-hand [data-id="4"]').count(), 1);
    await ctx.close();
  });

  await test('select one card and discard it', async () => {
    const { page, ctx } = await open(scene('play', [4, 28, 52]));
    await page.click('.sr-hand [data-id="28"]');
    await page.click('[data-sr="discard"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'discard', card: 28 });
    await ctx.close();
  });

  await test('after laying down: select a card, tap a laid group to add it', async () => {
    const { page, ctx } = await open(scene('play', [76, 9], (v) => {
      v.players[0].laid = [{ kind: 'set', num: 5, cards: [card(4), card(28), card(52)] }, { kind: 'run', lo: 2, hi: 4, cards: [card(1), card(2), card(3)] }];
    }));
    await page.click('.sr-hand [data-id="76"]');
    await page.click('[data-sr="hit"][data-owner="0"][data-group="0"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'hit', card: 76, owner: 0, group: 0 });
    await ctx.close();
  });

  await test('a wild card on a run: the player chooses the low or high end', async () => {
    const { page, ctx } = await open(scene('play', [96, 9], (v) => {
      v.players[0].laid = [{ kind: 'run', lo: 2, hi: 4, cards: [card(1), card(2), card(3)] }];
    }));
    await page.click('.sr-hand [data-id="96"]');
    assert.equal(await page.locator('[data-sr="hit"][data-end="low"]').count(), 1, 'low end offered');
    assert.equal(await page.locator('[data-sr="hit"][data-end="high"]').count(), 1, 'high end offered');
    await page.click('[data-sr="hit"][data-end="low"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'hit', card: 96, owner: 0, group: 0, end: 'low' });
    await ctx.close();
  });

  await test('not your turn: nothing to press', async () => {
    const { page, ctx } = await open(scene('draw', [4, 5], (v) => { v.myTurn = false; v.turn = 1; }));
    assert.equal(await page.locator('[data-sr="draw"]:not([disabled])').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Bo is taking a turn/);
    await ctx.close();
  });

  await test('game over lists stages and points and offers rematch to the host', async () => {
    const { page, ctx } = await open(scene('gameOver', [], (v) => { v.myTurn = false; v.winners = [1]; v.players.forEach((p, i) => { p.stage = [4, 6, 5, 3][i]; p.score = 10 * i; }); }));
    const items = await page.locator('.sr-final li').allTextContents();
    assert.match(items[0], /Bo/);
    assert.equal(await page.locator('[data-sr="again"]').count(), 1);
    await ctx.close();
  });

  await test('mid-round, four players with laid groups: each seat keeps its box, the groups stay inside it, the hand is on screen', async () => {
    const SR = require('../../games/stagerummy/engine');
    const msgs = tableMessages('stagerummy', four);
    const v = msgs[1].view;
    v.players[1].laid = [{ kind: 'set', num: 5, cards: [card('R5a'), card('B5a'), card('G5a')].map((c) => c) }];
    v.players[2].laid = [{ kind: 'run', lo: 2, hi: 4, cards: [card('R2a'), card('R3a'), card('R4a')] }];
    v.players[3].laid = [{ kind: 'set', num: 9, cards: [card('R9a'), card('B9a'), card('G9a')] }, { kind: 'run', lo: 6, hi: 8, cards: [card('R6a'), card('R7a'), card('R8a')] }];
    const { page, ctx } = await open(msgs, { width: 393, height: 852 });
    const r = await page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const seats = [...document.querySelectorAll('.sr .pseat')].map((seat) => {
        const s = box(seat);
        const groups = [...seat.querySelectorAll('.sr-group')].map(box);
        return { h: Math.round(s.height), inside: groups.every((g) => g.left >= s.left - 1 && g.right <= s.right + 1 && g.bottom <= s.bottom + 1) };
      });
      const hand = [...document.querySelectorAll('.sr .sr-hand .sr-card')].map(box);
      return { seats, n: hand.length, handBottom: Math.max(...hand.map((h) => h.bottom)), vh: innerHeight, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    assert.equal(r.seats.length, 4, 'four seats');
    assert.ok(r.n > 0, 'the hand has cards to measure');
    assert.ok(r.seats.every((s) => s.inside), 'every laid group sits inside its seat: ' + JSON.stringify(r.seats));
    assert.ok(new Set(r.seats.map((s) => s.h)).size <= 2, 'seat boxes keep their heights: ' + JSON.stringify(r.seats.map((s) => s.h)));
    assert.ok(r.handBottom <= r.vh, `the hand is on screen (bottom ${Math.round(r.handBottom)}, screen ${r.vh})`);
    assert.ok(r.over <= 0, 'no sideways scroll');
    await ctx.close();
  });

  await test('six players with ten cards in hand: the whole hand is on an iPhone 15 screen without scrolling', async () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name }));
    const msgs = tableMessages('stagerummy', six);
    const { page, ctx } = await open(msgs, { width: 393, height: 852 });
    const r = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.sr .sr-hand .sr-card')].map((el) => el.getBoundingClientRect());
      return { n: cards.length, bottom: Math.max(...cards.map((c) => c.bottom)), vh: innerHeight, page: document.documentElement.scrollHeight };
    });
    assert.ok(r.n > 0, 'the hand has cards to measure');
    assert.ok(r.bottom <= r.vh, `last row of the hand ends at ${Math.round(r.bottom)}, screen is ${r.vh}`);
    assert.ok(r.page <= r.vh + 1, `the page scrolls (${r.page} > ${r.vh})`);
    await ctx.close();
  });

  await test('a 320 px phone: six players, nothing overflows sideways', async () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name }));
    const { page, ctx } = await open(tableMessages('stagerummy', six), { width: 320, height: 640 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'horizontal overflow ' + over);
    await ctx.close();
  });

  await test('four seats stay fully exposed on a short phone even with laid groups', async () => {
    const msgs = scene('draw', [12, 13, 14, 15], (v) => {
      v.players.forEach((p, i) => {
        p.cards = i === 0 ? 10 : 2;
        p.score = 25 + i;
        if (i > 0) p.laid = expandedGroups();
      });
    });
    const { page, ctx } = await open(msgs, { width: 360, height: 640 });
    try {
      const seats = page.locator('.sr-seats');
      assert.equal(await seats.locator('.pseat').count(), 4);
      assert.equal(await seats.locator('.sr-group').count(), 6);
      assert.deepEqual(await seats.locator('.sr-nolay').allInnerTexts(),
        ['10 cards · 25 pts', '2 cards · 26 pts', '2 cards · 27 pts', '2 cards · 28 pts']);
      const { clipped, scrollTop } = await seats.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        const bounds = el.getBoundingClientRect();
        return {
          clipped: [...el.querySelectorAll('.pseat')].some((seat) => {
            const box = seat.getBoundingClientRect();
            return box.top < bounds.top || box.bottom > bounds.bottom;
          }),
          scrollTop: el.scrollTop,
        };
      });
      assert.equal(clipped, false, 'every seat fits inside the seat region');
      assert.equal(scrollTop, 0, 'laid cards do not introduce inner scrolling for four players');
    } finally {
      await ctx.close();
    }
  });

  await test('five seats can scroll to the final player on a tall phone', async () => {
    const msgs = tableMessages('stagerummy', [...four, { name: 'Eli' }]);
    msgs[1].view.players.forEach((p) => { p.laid = expandedGroups(); });
    const { page, ctx } = await open(msgs, { width: 360, height: 800 });
    try {
      const seats = page.locator('.sr-seats');
      assert.equal(await seats.locator('.pseat').count(), 5);
      const { overflowY, height, scrollTop, lastSeatFits } = await seats.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        return {
          overflowY: getComputedStyle(el).overflowY,
          height: el.clientHeight,
          scrollTop: el.scrollTop,
          lastSeatFits: el.lastElementChild.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1,
        };
      });
      assert.equal(overflowY, 'auto');
      assert.ok(height <= 240 && scrollTop > 0, 'expanded seats scroll within the capped region');
      assert.equal(lastSeatFits, true, 'the final seat can be brought into view');
      assert.equal((await seats.locator('.av').first().boundingBox()).width, 24);
    } finally {
      await ctx.close();
    }
  });

  await test('Stage 10 switches to compact counts and larger portrait cards on short phones', async () => {
    const { page, ctx } = await open(scene('draw', [4, 5, 6], (v) => {
      v.players[0].cards = 10;
      v.players[0].score = 125;
    }), { width: 520, height: 640 });
    try {
      const seat = page.locator('.sr-seats .pseat').first();
      const count = seat.locator('.sr-nolay');
      const avatar = seat.locator('.av');
      assert.equal(await count.innerText(), '10 cards · 125 pts');
      assert.equal(await count.evaluate((el) => getComputedStyle(el).whiteSpace), 'nowrap');
      const phoneAvatar = await avatar.boundingBox();
      assert.equal(phoneAvatar.width, 28);
      await page.setViewportSize({ width: 360, height: 640 });
      const handCard = await page.locator('.sr-hand .sr-card').first().boundingBox();
      assert.ok(handCard.height >= 52, 'hand card is tall enough on a short phone');
      assert.ok(Math.abs(handCard.width * 4 / 3 - handCard.height) < 1, 'hand card keeps its portrait shape');
      await page.setViewportSize({ width: 521, height: 640 });
      assert.equal((await count.innerText()).replace(/\s+/g, ' '), 'Not down · 10 cards · 125 pts');
      assert.ok((await avatar.boundingBox()).width > phoneAvatar.width, 'wider seats retain larger avatars');
    } finally {
      await ctx.close();
    }
  });

  await test('a skip shows in the box under the table and the spotlight; history from before the table was seen is not replayed', async () => {
    const msgs = scene('play', [4, 5, 6], (v) => { v.log = [{ type: 'discard', by: 1, label: 'Blue 5', seq: 1 }]; v.event = v.log[0]; });
    const { page, ctx } = await open(msgs);
    const base = msgs[1];
    await page.evaluate((st) => {
      const v = st.view;
      v.log = v.log.concat([{ type: 'skip', by: 1, who: 2, seq: 2 }]);
      v.event = v.log[v.log.length - 1];
      window.__push({ t: 'state', room: st.room, view: v });
    }, base);
    await page.waitForFunction(() => /loses a turn/.test((document.querySelector('.sr-event') || {}).textContent || ''), null, { timeout: 8000 });
    const feed = await page.textContent('.sr-event');
    assert.match(feed, /loses a turn/, 'the skip is in the box under the table');
    assert.doesNotMatch(feed, /Blue 5/, 'the earlier discard is not replayed when the table is first seen');
    await page.waitForSelector('.gf-spot', { timeout: 2000 });
    assert.match(await page.textContent('.gf-spot'), /played Skip/, 'the spotlight names the skip');
    assert.match(await page.textContent('.sr-table'), /Not down · \d+ cards · \d+ pts/, 'a seat that is not down shows its points');
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
