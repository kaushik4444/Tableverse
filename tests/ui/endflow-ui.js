'use strict';
// End of a game in a real browser: the finished table first, then a "<name> won" pop-up, then the result with Leave / Play again / vote.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];

function finished(hostId, sinceMs, votes = []) {
  const msgs = tableMessages('gofish', four);
  const view = msgs[1].view; view.phase = 'gameOver'; view.myTurn = false; view.winners = [1];
  view.players[1].bookCount = 5; view.players[1].books = ['2', '3', '4', '5', '6'];
  Object.assign(msgs[1].room, { status: 'finished', hostId, votes, outcome: { winners: [{ id: 'p1', name: 'Bo' }], sinceMs } });
  return msgs;
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages) => {
    const { page, ctx } = await scriptedPage(browser, { messages });
    await page.goto(url + '/');
    await page.waitForSelector('.gf', { timeout: 8000 });
    return { page, ctx };
  };

  await test('a game that just ended: table, then the winner pop-up, then the result', async () => {
    const { page, ctx } = await open(finished('me', 0));
    assert.equal(await page.isVisible('.overlay'), false, 'result is held back while the board is shown');
    await page.waitForSelector('.end-pop', { timeout: 6000 });
    assert.match(await page.textContent('.end-pop'), /Bo won/);
    await page.waitForSelector('.end-actions', { timeout: 6000 });
    assert.equal(await page.isVisible('.end-pop'), false);
    assert.ok(await page.isVisible('.overlay'));
    await page.click('[data-act="endAgain"]');
    assert.equal((await page.evaluate(() => window.__sent.filter((m) => m.t === 'rematch'))).length, 1);
    await ctx.close();
  });

  await test('not the host: vote to play again with the vote count, and leave', async () => {
    const { page, ctx } = await open(finished('p2', 20000, ['p1']));
    await page.waitForSelector('.end-actions');
    assert.match(await page.textContent('.end-votes'), /1\/3/);
    assert.equal(await page.$('[data-act="endAgain"]'), null);
    await page.click('[data-act="endVote"]');
    assert.deepEqual(await page.evaluate(() => window.__sent.filter((m) => m.t === 'rematchVote')), [{ t: 'rematchVote', on: true }]);
    await page.click('[data-act="endLeave"]');
    assert.equal((await page.evaluate(() => window.__sent.filter((m) => m.t === 'leave'))).length, 1);
    await ctx.close();
  });

  for (const game of ['poker', 'stagerummy']) {
    await test(`${game}: sheet focus follows the shared end flow`, async () => {
      const msgs = tableMessages(game, four);
      const { page, ctx } = await scriptedPage(browser, { messages: msgs, viewport: { width: 1280, height: 860 } });
      await page.goto(url + '/');
      const action = game === 'poker' ? 'pk' : 'sr';
      const opener = `[data-${action}="${game === 'poker' ? 'ranks' : 'phases'}"]`;
      await page.waitForSelector(`.${action}`);
      if (!(await page.isVisible(opener))) await page.click('.tb-more-btn');
      await page.click(opener);
      const close = `button[data-${action}="${game === 'poker' ? 'closeRanks' : 'closePhases'}"]`;
      await page.focus(close);
      await page.evaluate(() => {
        window.__hiddenSheetFocus = 0;
        const focus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function (...args) {
          if (this.matches('button[data-sr="closePhases"]') && this.closest('.endhold')) window.__hiddenSheetFocus++;
          return focus.apply(this, args);
        };
      });
      const final = structuredClone(msgs[1]);
      final.view.phase = 'gameOver'; final.view.myTurn = false;
      final.view.winners = [0];
      if (game === 'poker') final.view.standings = final.view.players.map((p, i) => ({ player: i, rank: i + 1, chips: p.chips }));
      Object.assign(final.room, { status: 'finished', outcome: { winners: [{ id: 'me', name: 'Aarav' }], sinceMs: 6200 } });
      await page.evaluate((m) => window.__push(m), final);
      await page.waitForSelector('.end-actions');
      const target = game === 'poker' ? '[data-act="endAgain"]' : close;
      await page.waitForFunction((sel) => document.activeElement === document.querySelector(sel), target);
      assert.ok(await page.isVisible(target));
      assert.equal(await page.evaluate(() => window.__hiddenSheetFocus), 0, 'never focus Stages while endhold hides it');
      if (game === 'poker') assert.equal(await page.$(close), null, 'rankings close on game over');
      else {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), close), true);
      }
      await ctx.close();
    });
  }

  await test('Stages redraw preserves focus inside the sheet and outside in chat', async () => {
    const msgs = tableMessages('stagerummy', four);
    const { page, ctx } = await scriptedPage(browser, { messages: msgs, viewport: { width: 1280, height: 860 } });
    await page.goto(url + '/');
    await page.waitForSelector('.sr');
    if (!(await page.isVisible('[data-sr="phases"]'))) await page.click('.tb-more-btn');
    await page.click('[data-sr="phases"]');
    const close = 'button[data-sr="closePhases"]';
    await page.focus(close);
    const next = structuredClone(msgs[1]); next.view.round++;
    await page.evaluate((m) => window.__push(m), next);
    assert.equal(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), close), true);
    await page.evaluate(() => document.querySelector('[data-act="chat"]').click());
    await page.focus('#chat-input');
    next.view.round++;
    await page.evaluate((m) => window.__push(m), next);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'chat-input');
    await ctx.close();
  });

  await test('joining or creating blocks every other tap behind a spinner until the table arrives', async () => {
    const msgs = tableMessages('gofish', four);
    const welcomeOnly = [msgs[0]];
    const { page, ctx } = await scriptedPage(browser, { messages: welcomeOnly });
    await page.goto(url + '/');
    await page.waitForSelector('[data-act="create"]', { timeout: 8000 });
    await page.click('[data-act="create"]');
    await page.waitForSelector('.busy-block');
    assert.match(await page.textContent('.busy-block'), /Creating/);
    assert.equal(await page.evaluate(() => document.getElementById('app').hasAttribute('inert')), true);
    assert.ok((await page.evaluate(() => window.__sent.filter((m) => m.t === 'create'))).length === 1);
    await page.evaluate(() => window.__push && window.__push({ t: 'error', message: 'nope' }));
    await page.waitForSelector('.busy-block', { state: 'detached' });
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
