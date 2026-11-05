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
