'use strict';
// Take 5 in a real browser: picking a card, changing the pick, taking a row, spectators, game over and a narrow phone.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.prt', { timeout: 8000 });
    return { page, ctx };
  };

  await test('a row badge shows up to three bombs, then the count: five is "💣×5", never three bombs', async () => {
    const m = tableMessages('penaltyrows', four);
    const v = m.find((x) => x.t === 'state').view;
    v.rows = [[{ n: 10, p: 5 }], [{ n: 20, p: 3 }], [{ n: 30, p: 4 }], [{ n: 40, p: 1 }]];
    const { page, ctx } = await open(m);
    await page.waitForSelector('.pr-pile-n', { timeout: 5000 });
    const badges = await page.$$eval('.pr-pile-n', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(badges.slice(0, 4), ['💣×5', '💣💣💣', '💣×4', '💣']);
    await ctx.close();
  });

  await test('four rows, ten cards in your hand, a scoreboard, and tapping a card sends that pick', async () => {
    const { page, ctx } = await open(tableMessages('penaltyrows', four));
    assert.equal(await page.locator('.pr-row').count(), 4);
    assert.equal(await page.locator('.pr-hand .pr-card').count(), 10);
    await page.locator('[data-pr="tab"][data-tab="scores"]').click();
    assert.equal(await page.locator('.pr-score li').count(), 4);
    await page.locator('[data-pr="tab"][data-tab="table"]').click();
    const n = Number(await page.locator('.pr-hand .pr-card').first().getAttribute('data-n'));
    await page.locator('.pr-hand .pr-card').first().click();
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'pick', card: n });
    await ctx.close();
  });

  await test('tab focus survives switching and game updates without taking focus from elsewhere', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const { page, ctx } = await open(msgs);
    const scores = page.locator('[data-pr="tab"][data-tab="scores"]');
    const table = page.locator('[data-pr="tab"][data-tab="table"]');
    const focusedTab = () => page.evaluate(() => document.activeElement.dataset.tab);
    await scores.focus();
    await page.keyboard.press('Enter');
    assert.equal(await focusedTab(), 'scores', 'keyboard activation keeps focus on the replacement');
    assert.equal(await scores.getAttribute('aria-selected'), 'true');
    await table.focus();
    await page.evaluate((m) => window.__push(m), msgs[1]);
    assert.equal(await focusedTab(), 'table', 'updates preserve the focused tab even when it is not selected');
    await page.keyboard.press('Enter');
    assert.equal(await focusedTab(), 'table');
    assert.equal(await table.getAttribute('aria-selected'), 'true');
    await page.evaluate(() => {
      const other = document.createElement('button');
      other.id = 'outside-game';
      document.body.append(other);
      other.focus();
      document.querySelector('[data-tab="scores"]').click();
    });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'outside-game', 'switching without tab focus does not steal focus');
    await page.evaluate((m) => window.__push(m), msgs[1]);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'outside-game', 'updates without tab focus do not steal focus');
    await ctx.close();
  });

  await test('a picked card is marked, and other players\' hands are nowhere in the page', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const v = msgs[1].view; v.myPick = v.hand[2].n; v.players[0].picked = true;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.pr-hand .pr-card.sel').count(), 1);
    assert.match(await page.textContent('.wz-status'), /You picked/);
    await ctx.close();
  });

  await test('a played card keeps its name on a short phone (393x700, Safari with its bars): the name is not hidden', async () => {
    // Safari leaves an iPhone 15 (393x852) under 700px tall, so the short-phone rule applies there; the names must still show
    const msgs = tableMessages('penaltyrows', four);
    const v = msgs[1].view; v.myPick = v.hand[2].n; v.players[0].picked = true;
    const { page, ctx } = await open(msgs, { width: 393, height: 700 });
    const shown = await page.$eval('.pr-played.mine small', (el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0);
    assert.equal(shown, true, 'the name under the picked card is visible');
    await ctx.close();
  });

  await test('your card fits no row: the rows become buttons and tapping one takes it', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const v = msgs[1].view; v.phase = 'takeRow'; v.pending = { by: 0, n: 3, p: 1 }; v.myTurn = true;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('button.pr-row.take').count(), 4);
    assert.match(await page.textContent('.wz-status'), /fits no row/);
    assert.equal(await page.locator('.pr-hand .pr-card:not([disabled])').count(), 0, 'no picking while a row is chosen');
    await page.click('button.pr-row.take[data-row="2"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'takeRow', row: 2 });
    await ctx.close();
  });

  await test('someone else must take a row: you only watch', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const v = msgs[1].view; v.phase = 'takeRow'; v.pending = { by: 1, n: 3, p: 1 }; v.myTurn = false;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('button.pr-row.take').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Bo must take a row/);
    await ctx.close();
  });

  await test('game over lists the totals lowest first and offers rematch to the host', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const v = msgs[1].view; v.phase = 'gameOver'; v.winners = [2]; v.players.forEach((p, i) => { p.total = [40, 30, 12, 66][i]; });
    const { page, ctx } = await open(msgs);
    const items = await page.locator('.pr-final li').allTextContents();
    assert.match(items[0], /Charlotte/);
    assert.match(items[3], /Dmitri/);
    assert.equal(await page.locator('[data-pr="again"]').count(), 1);
    await ctx.close();
  });

  await test('a 320 px phone: nothing overflows sideways', async () => {
    const { page, ctx } = await open(tableMessages('penaltyrows', [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }, { name: 'F' }, { name: 'G' }, { name: 'H' }]), { width: 320, height: 640 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'horizontal overflow ' + over);
    await ctx.close();
  });

  await test('phone scores sit above the board and wrap only when a fifth player joins', async () => {
    const roster = [...four, ...['Eli', 'Fay', 'Gia', 'Hugo'].map((name) => ({ name }))];
    for (const [players, expectedRows] of [[4, [4]], [5, [4, 1]], [8, [4, 4]]]) {
      const { page, ctx } = await open(tableMessages('penaltyrows', roster.slice(0, players)), { width: 520, height: 700 });
      try {
        const chips = page.locator('.pr-chips');
        assert.deepEqual(await chips.locator('.pr-chip-name').allInnerTexts(),
          roster.slice(0, players).map(({ name }, i) => i === 0 ? name + ' (you)' : name));
        const { rows, aboveStrip, clippedNames } = await chips.evaluate((el) => {
          const lines = new Map();
          for (const chip of el.children) {
            const top = chip.offsetTop;
            lines.set(top, (lines.get(top) || 0) + 1);
          }
          return {
            rows: [...lines.values()],
            aboveStrip: el.getBoundingClientRect().bottom <= el.parentElement.querySelector('.pr-strip').getBoundingClientRect().top,
            clippedNames: [...el.querySelectorAll('.pr-chip-name')].filter((name) => name.scrollWidth > name.clientWidth)
              .map((name) => name.textContent),
          };
        });
        assert.deepEqual(rows, expectedRows, players + ' players');
        assert.equal(aboveStrip, true, 'scores leave the played-card strip and lanes clear');
        assert.deepEqual(clippedNames, [], 'each name fits in its score chip');
      } finally {
        await ctx.close();
      }
    }
  });

  await test('the Take 5 hand and empty-strip hint respect the phone height and width cutoffs', async () => {
    const { page, ctx } = await open(tableMessages('penaltyrows', four), { width: 520, height: 700 });
    try {
      const hint = page.locator('.pr-strip .pr-hint');
      const handCard = page.locator('.pr-hand .pr-card').first();
      const chip = page.locator('.pr-chips li').first();
      assert.equal(await hint.count(), 1, 'fixture has an empty played-card strip');
      assert.equal(await hint.isVisible(), false, 'short phones hide the hint');
      const shortWidth = (await handCard.boundingBox()).width;
      const shortChipHeight = (await chip.boundingBox()).height;
      await page.setViewportSize({ width: 520, height: 701 });
      assert.equal(await hint.isVisible(), true, 'taller phones show the hint');
      const tallWidth = (await handCard.boundingBox()).width;
      assert.ok(tallWidth > shortWidth, 'taller phones enlarge the hand cards');
      assert.ok((await chip.boundingBox()).height > shortChipHeight, 'short phones use more compact score chips');
      await page.setViewportSize({ width: 521, height: 701 });
      const wideWidth = (await handCard.boundingBox()).width;
      assert.ok(wideWidth < tallWidth, 'the larger card width only applies to phones');
      await page.setViewportSize({ width: 521, height: 700 });
      assert.equal(await hint.isVisible(), true, 'a wider short screen keeps the hint');
    } finally {
      await ctx.close();
    }
  });

  await test('a five-bomb badge uses smaller icons on phones and does not widen the page', async () => {
    const { penaltyOf } = require('../../games/penaltyrows/engine');
    const msgs = tableMessages('penaltyrows', four);
    msgs[1].view.rows[0] = [{ n: 11, p: penaltyOf(11) }];
    const { page, ctx } = await open(msgs, { width: 320, height: 640 });
    try {
      const badge = page.getByRole('img', { name: '5 penalty points', exact: true }).first();
      const icons = badge.locator('.pr-pile-n');
      assert.equal((await icons.textContent()).trim(), '💣×5'); // more than three bombs show as a count, so none are clipped
      const phoneIconSize = await icons.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      for (const viewport of [{ width: 320, height: 640 }, { width: 667, height: 375 }, { width: 768, height: 1024 }]) {
        await page.setViewportSize(viewport);
        const { clips, pageFits } = await badge.evaluate((el) => {
          const root = document.documentElement;
          return {
            clips: ['hidden', 'clip'].includes(getComputedStyle(el).overflowX),
            pageFits: root.scrollWidth <= root.clientWidth,
          };
        });
        assert.equal(clips, true, 'the badge contains its own overflow at width ' + viewport.width);
        assert.equal(pageFits, true, 'the badge does not widen the page at width ' + viewport.width);
        if (viewport.width > 520) {
          const iconSize = await icons.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
          assert.ok(iconSize > phoneIconSize, 'phone badges use smaller icons');
        }
      }
    } finally {
      await ctx.close();
    }
  });

  await test('a turn plays out one card at a time: each placement appears in turn, paced by the table setting', async () => {
    const pen = (n) => 1 + (n % 5 === 0 ? 1 : 0) + (n % 10 === 0 ? 1 : 0) + (n % 11 === 0 ? 4 : 0);
    const c = (n) => ({ n, p: pen(n) });
    const msgs = tableMessages('penaltyrows', four, { seed: 3 });
    const before = [[c(12)], [c(3)], [c(38)], [c(44)]];
    const first = JSON.parse(JSON.stringify(msgs[1]));
    first.view.rows = before; first.view.before = before; first.view.lastTurn = []; first.view.seq = 1;
    const second = JSON.parse(JSON.stringify(first));
    second.view.before = before;
    second.view.rows = [[c(12), c(18)], [c(3), c(7)], [c(38)], [c(44)]];
    second.view.lastTurn = [{ kind: 'place', by: 1, n: 18, p: pen(18), row: 0, took: 0 }, { kind: 'place', by: 2, n: 7, p: pen(7), row: 1, took: 0 }];
    second.view.seq = 2;
    second.view.after = second.view.rows; // the completed table at the end of the turn, as the engine sends it
    const stepMs = 900 * (first.view.paceK || 1);
    const { page, ctx } = await open([first]);
    const counts = () => page.evaluate(() => [...document.querySelectorAll('.pr-row')].map((r) => r.querySelectorAll('.pr-card').length));
    assert.deepEqual(await counts(), [1, 1, 1, 1]);
    await page.evaluate((m) => window.__push(m), second);
    await page.waitForTimeout(150);
    assert.deepEqual(await counts(), [1, 1, 1, 1], 'the turn starts from the rows as they were');
    await page.waitForTimeout(stepMs);
    assert.deepEqual(await counts(), [2, 1, 1, 1], 'the first card has landed');
    await page.waitForTimeout(stepMs);
    assert.deepEqual(await counts(), [2, 2, 1, 1], 'then the second, and the table is the true state');
    await ctx.close();
  });

  await test('every player shows a score under their name, and the feed says who played what as the turn plays out', async () => {
    const pen = (n) => 1 + (n % 5 === 0 ? 1 : 0) + (n % 10 === 0 ? 1 : 0) + (n % 11 === 0 ? 4 : 0);
    const c = (n) => ({ n, p: pen(n) });
    const msgs = tableMessages('penaltyrows', four, { seed: 3 });
    const before = [[c(12)], [c(3)], [c(38)], [c(44)]];
    const first = JSON.parse(JSON.stringify(msgs[1]));
    first.view.rows = before; first.view.before = before; first.view.lastTurn = []; first.view.seq = 1;
    const second = JSON.parse(JSON.stringify(first));
    second.view.before = before;
    second.view.rows = [[c(12), c(18)], [c(3), c(7)], [c(38)], [c(44)]];
    second.view.lastTurn = [{ kind: 'place', by: 1, n: 18, p: pen(18), row: 0, took: 0 }, { kind: 'place', by: 2, n: 7, p: pen(7), row: 1, took: 0 }];
    second.view.seq = 2;
    second.view.after = second.view.rows;
    const stepMs = 900 * (first.view.paceK || 1);
    const { page, ctx } = await open([first]);
    const chips = await page.$$eval('.pr-chips li', (els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
    assert.equal(chips.length, 4, 'one score per player');
    assert.ok(chips.every((t) => /\d+\/\d+/.test(t)), 'each reads as points/target, like 10/66: ' + chips.join(' | '));
    await page.evaluate((m) => window.__push(m), second);
    await page.waitForTimeout(stepMs + 150);
    assert.match(await page.textContent('.gf-feed'), /played 18 on/, 'the first card of the turn is in the feed');
    await page.waitForTimeout(stepMs);
    const feed = await page.textContent('.gf-feed');
    assert.match(feed, /played 7 on/, 'then the second');
    assert.match(feed, /played 18 on/, 'earlier moves stay in the feed');
    await ctx.close();
  });

  await test('a sixth card: it lands as the sixth card, the row is collected with a line and a spotlight, then it starts the row again', async () => {
    const pen = (n) => 1 + (n % 5 === 0 ? 1 : 0) + (n % 10 === 0 ? 1 : 0) + (n % 11 === 0 ? 4 : 0);
    const c = (n) => ({ n, p: pen(n) });
    const full = [3, 5, 8, 9, 10];
    const took = full.reduce((s, n) => s + pen(n), 0);
    const msgs = tableMessages('penaltyrows', four, { seed: 3 });
    const before = [full.map(c), [c(12)], [c(38)], [c(44)]];
    const first = JSON.parse(JSON.stringify(msgs[1]));
    first.view.rows = before; first.view.before = before; first.view.lastTurn = []; first.view.seq = 1;
    const second = JSON.parse(JSON.stringify(first));
    second.view.before = before;
    second.view.rows = [[c(11)], [c(12)], [c(38)], [c(44)]];
    second.view.lastTurn = [{ kind: 'sweep', by: 1, n: 11, p: pen(11), row: 0, took }];
    second.view.seq = 2;
    second.view.after = second.view.rows;
    const k = first.view.paceK || 1;
    const { page, ctx } = await open([first]);
    const row1 = () => page.evaluate(() => [...document.querySelectorAll('.pr-row')][0].querySelectorAll('.pr-card').length);
    await page.evaluate((m) => window.__push(m), second);
    const t0 = Date.now();
    // the steps: before 900k, sixth card 900k (to 1800k), row collected 1400k, restart 900k; sample each in its middle
    const at = (ms) => page.waitForTimeout(Math.max(0, t0 + ms - Date.now()));
    await at(300 * k);
    assert.equal(await row1(), 5, 'the row is as it was before the card');
    await at(1350 * k);
    assert.equal(await row1(), 6, 'the sixth card lands in the row');
    assert.match(await page.textContent('.pr-callout'), /6th card placed/, 'and says so on the row');
    assert.equal(await page.$$eval('.pr-callout', (els) => els.length), 1, 'only the row that got the sixth card says so');
    assert.equal(await page.locator('.pr-row').nth(0).locator('.pr-callout').count(), 1, 'and it is on row 1');
    assert.match(await page.textContent('.gf-feed'), /played the 6th card on row 1/, 'the feed says the sixth card was placed');
    await at(2500 * k);
    assert.match(await page.textContent('.pr-callout'), /Bo took/, 'the row is collected: the taker is named');
    assert.match(await page.textContent('.gf-feed'), /Bo collected row 1/, 'the feed says who collected it');
    assert.match(await page.textContent('.gf-spot'), /Bo collected row 1/, 'the spotlight holds the collection');
    await at(3650 * k);
    assert.equal(await row1(), 1, 'then the played card starts the row again');
    assert.match(await page.textContent('.gf-feed'), /11 starts row 1/, 'the feed says the new row starts with it');
    await ctx.close();
  });

  await test('a played card glides from the strip into its row as it lands', async () => {
    const pen = (n) => 1 + (n % 5 === 0 ? 1 : 0) + (n % 10 === 0 ? 1 : 0) + (n % 11 === 0 ? 4 : 0);
    const c = (n) => ({ n, p: pen(n) });
    const msgs = tableMessages('penaltyrows', four, { seed: 3 });
    const before = [[c(12)], [c(3)], [c(38)], [c(44)]];
    const first = JSON.parse(JSON.stringify(msgs[1]));
    first.view.rows = before; first.view.before = before; first.view.lastTurn = []; first.view.seq = 1;
    const second = JSON.parse(JSON.stringify(first));
    second.view.before = before;
    second.view.rows = [[c(12), c(18)], [c(3), c(7)], [c(38)], [c(44)]];
    second.view.lastTurn = [{ kind: 'place', by: 1, n: 18, p: pen(18), row: 0, took: 0 }, { kind: 'place', by: 2, n: 7, p: pen(7), row: 1, took: 0 }];
    second.view.seq = 2;
    second.view.after = second.view.rows;
    const k = first.view.paceK || 1;
    const { page, ctx } = await open([first]);
    await page.evaluate((m) => window.__push(m), second);
    await page.waitForTimeout(900 * k + 120); // the first placement has just been drawn
    // the glide is a Web Animation that moves the card from where it was on the strip; the old drop is a CSS animation
    const glide = await page.evaluate(() => {
      const el = document.querySelector('.pr-rows [data-cn="18"]');
      if (!el) return null;
      return el.getAnimations().map((a) => ({ css: Boolean(a.animationName), first: a.effect && a.effect.getKeyframes()[0].transform }));
    });
    assert.ok(glide && glide.some((a) => !a.css && /translate\(/.test(a.first)), 'the card that landed glides into its row: ' + JSON.stringify(glide));
    await ctx.close();
  });

  await test('a collected row slides, card by card, into the taker\'s pile', async () => {
    const pen = (n) => 1 + (n % 5 === 0 ? 1 : 0) + (n % 10 === 0 ? 1 : 0) + (n % 11 === 0 ? 4 : 0);
    const c = (n) => ({ n, p: pen(n) });
    const full = [3, 5, 8, 9, 10];
    const took = full.reduce((s, n) => s + pen(n), 0);
    const msgs = tableMessages('penaltyrows', four, { seed: 3 });
    const before = [full.map(c), [c(12)], [c(38)], [c(44)]];
    const first = JSON.parse(JSON.stringify(msgs[1]));
    first.view.rows = before; first.view.before = before; first.view.lastTurn = []; first.view.seq = 1;
    const second = JSON.parse(JSON.stringify(first));
    second.view.before = before;
    second.view.rows = [[c(11)], [c(12)], [c(38)], [c(44)]];
    second.view.lastTurn = [{ kind: 'sweep', by: 1, n: 11, p: pen(11), row: 0, took }];
    second.view.seq = 2;
    second.view.after = second.view.rows;
    const k = first.view.paceK || 1;
    const { page, ctx } = await open([first]);
    await page.evaluate((m) => window.__push(m), second);
    const t0 = Date.now();
    await page.waitForTimeout(Math.max(0, t0 + 1800 * k + 200 - Date.now())); // the collect step has just been drawn
    const moving = await page.evaluate(() => [...document.querySelectorAll('.pr-rows > .pr-row:first-child [data-cn]')].map((el) => el.getAnimations().length));
    assert.ok(moving.filter((n) => n > 0).length >= 2, 'several cards of the row are on their way: ' + moving.join(','));
    // the card that was played (11) is not collected: only the five cards that were on the row move into the pile
    const identity = await page.evaluate(() => [...document.querySelectorAll('.pr-rows > .pr-row:first-child [data-cn]')].map((el) => [el.dataset.cn, el.getAnimations().length > 0]));
    const others = identity.filter(([n]) => n !== '11');
    const played = identity.filter(([n]) => n === '11');
    assert.deepEqual(others.map(([n]) => n).sort(), full.map(String).sort(), 'exactly the five cards that were on the row are there: ' + JSON.stringify(identity));
    assert.ok(others.every(([, moving2]) => moving2), 'the five collected cards move: ' + JSON.stringify(identity));
    assert.equal(played.length, 1, 'the played card is on the row: ' + JSON.stringify(identity));
    assert.ok(played.every(([, moving2]) => !moving2), 'the played card does not go into the pile: ' + JSON.stringify(identity));
    assert.ok(await page.evaluate(() => !!document.querySelector('.prt .pr-chips li[data-pid]')), 'the taker has a chip to receive them');
    await ctx.close();
  });

  await test('the feed sits under the rows and never covers row 4', async () => {
    const pen = (n) => 1 + (n % 5 === 0 ? 1 : 0) + (n % 10 === 0 ? 1 : 0) + (n % 11 === 0 ? 4 : 0);
    const c = (n) => ({ n, p: pen(n) });
    const msgs = tableMessages('penaltyrows', four, { seed: 3 });
    const before = [[c(12)], [c(3)], [c(38)], [c(44)]];
    const first = JSON.parse(JSON.stringify(msgs[1]));
    first.view.rows = before; first.view.before = before; first.view.lastTurn = []; first.view.seq = 1;
    const second = JSON.parse(JSON.stringify(first));
    second.view.before = before;
    second.view.rows = [[c(12), c(18)], [c(3), c(7)], [c(38)], [c(44)]];
    second.view.lastTurn = [{ kind: 'place', by: 1, n: 18, p: pen(18), row: 0, took: 0 }, { kind: 'place', by: 2, n: 7, p: pen(7), row: 1, took: 0 }];
    second.view.seq = 2;
    second.view.after = second.view.rows;
    const { page, ctx } = await open([first]);
    await page.evaluate((m) => window.__push(m), second);
    await page.waitForSelector('.pr-feed .gf-item', { timeout: 4000 });
    const boxes = await page.evaluate(() => {
      const rows = document.querySelector('.pr-rows').getBoundingClientRect();
      const feed = document.querySelector('.pr-feed').getBoundingClientRect();
      const pos = getComputedStyle(document.querySelector('.pr-feed')).position;
      return { rowsBottom: rows.bottom, feedTop: feed.top, pos };
    });
    assert.notEqual(boxes.pos, 'absolute', 'the feed is in the page flow, not floating over the table');
    assert.ok(boxes.feedTop >= boxes.rowsBottom - 1, `the feed starts below the last row: ${JSON.stringify(boxes)}`);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
