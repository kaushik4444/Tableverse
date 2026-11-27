'use strict';
// Sea Battle in a real browser: the attack and fleet boards, tapping a square to fire, turns, the phone
// tabs, shots shown on both seas, the result sheet, and watchers.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const E = require('../../games/seabattle/engine');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo'];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));

/** A real game between you (me) and one other person, and the messages a browser would receive for it. */
/** A fleet laid out by hand: five ships, none touching. Used for the placed-fleet and hull tests. */
const SETUP = [{ r: 0, c: 0, vertical: false }, { r: 2, c: 0, vertical: false }, { r: 4, c: 0, vertical: false }, { r: 6, c: 0, vertical: false }, { r: 8, c: 0, vertical: false }];

/** A real game between you (me) and one other person, and the messages a browser would receive for it.
 *  opts.placing: the game is still in the placing phase (nobody has placed); opts.placed: only my fleet is placed. */
function table(setup = () => {}, { viewer = 'me', placing = false, placed = false } = {}) {
  const players = names.map((n, i) => ({ id: i === 0 ? 'me' : 'p1', name: n }));
  let seed = 21; const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const g = E.createGame(players, {}, rng);
  if (placed) E.applyAction(g, 'me', { type: 'place', ships: SETUP });
  if (!placing && !placed) {
    for (const id of ['me', 'p1']) { E.applyAction(g, id, { type: 'random' }); E.applyAction(g, id, { type: 'ready' }); }
  }
  setup(g);
  const room = { code: 'ABCDEF', gameId: 'seabattle', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: 2, min: 2, max: 2, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: '🧙', connected: true, ping: null, username: null })) };
  return [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: E.viewFor(g, viewer) }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.sb', { timeout: 8000 });
    return { page, ctx };
  };

  await test('on your turn the other sea has 100 open squares, and your own fleet is drawn with 100 squares', async () => {
    const { page, ctx } = await open(table());
    assert.equal(await page.locator('.sb-board.attack button.sb-cell.open:not(:disabled)').count(), 100);
    assert.equal(await page.locator('.sb-board.mine .sb-cell').count(), 100);
    await ctx.close();
  });

  await test('a tap on an open square fires at once, and sends that square', async () => {
    const { page, ctx } = await open(table());
    await page.locator('button.sb-cell.open').nth(42).click();
    const act = (await sent(page)).at(-1).action;
    assert.deepEqual(act, { type: 'fire', r: 4, c: 2 });
    await ctx.close();
  });

  await test('there is no Clear or Fire button in the game: a tap is the shot', async () => {
    const { page, ctx } = await open(table());
    assert.equal(await page.locator('[data-sb="fire"], [data-sb="clear"]').count(), 0);
    await ctx.close();
  });

  await test('the first view of a table does not replay its last shot', async () => {
    const msgs = table((g) => { g.shots[1][42] = 'miss'; g.event = { seq: 7, type: 'miss', by: 0, k: 42 }; });
    const { page, ctx } = await open(msgs);
    // the first view of a table does not replay the last shot: it is marked only when a later view brings it
    assert.equal(await page.locator('.sb-cell.fresh').count(), 0, 'no replay on load');
    await ctx.close();
  });

  await test('dragging a placed ship moves it: the grabbed square goes where the pointer is released', async () => {
    const { page, ctx } = await open(table(undefined, { placed: true }));
    const hull = await page.locator('.sb-grid.placing .sb-hull[data-slot="4"]').boundingBox();
    const grid = await page.locator('.sb-grid.placing').boundingBox();
    const cell = grid.width / 10;
    await page.mouse.move(hull.x + 4, hull.y + hull.height / 2);
    await page.mouse.down();
    await page.mouse.move(grid.x + cell * 5.5, grid.y + cell * 5.5, { steps: 6 });
    await page.mouse.up();
    const act = (await sent(page)).at(-1).action;
    assert.equal(act.type, 'place');
    assert.deepEqual(act.ships[4], { r: 5, c: 5, vertical: false }, 'the destroyer is now on F6-G6');
    await ctx.close();
  });

  await test('when it is not your turn the squares are disabled and the status says who is aiming', async () => {
    const { page, ctx } = await open(table((g) => { g.turn = 1; }));
    assert.equal(await page.locator('button.sb-cell.open:not(:disabled)').count(), 0);
    assert.match(await page.locator('.wz-status').innerText(), /Bo is aiming/);
    await ctx.close();
  });

  await test('hits, misses and a sunk ship are drawn on the attack sea', async () => {
    const msgs = table((g) => {
      g.shots[1][0] = 'hit';
      g.shots[1][1] = 'miss';
      g.shots[1][2] = 'sunk';
      g.shots[1][3] = 'sunk';
    });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.sb-board.attack .sb-cell.hit').count(), 1);
    assert.equal(await page.locator('.sb-board.attack .sb-cell.miss').count(), 1);
    assert.equal(await page.locator('.sb-board.attack .sb-cell.sunk').count(), 2);
    await ctx.close();
  });

  await test('on a 360 px phone one sea shows at a time, the tabs switch them, and nothing scrolls sideways', async () => {
    const { page, ctx } = await open(table(), { width: 360, height: 640 });
    assert.equal(await page.locator('.sb-tabs').isVisible(), true);
    assert.equal(await page.locator('.sb-board.attack').isVisible(), true);
    assert.equal(await page.locator('.sb-board.mine').isVisible(), false);
    await page.locator('[data-sb="tab-mine"]').click();
    assert.equal(await page.locator('.sb-board.mine').isVisible(), true);
    assert.equal(await page.locator('.sb-board.attack').isVisible(), false);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= 360, `page is ${scroll}px wide`);
    for (const sel of ['[data-sb="reset"]', '[data-sb="ready"]']) {
      const box = await page.locator(sel).boundingBox();
      assert.ok(box.height >= 44, `${sel} is ${box.height}px tall`);
    }
    await ctx.close();
  });

  await test('when the game is over the winner is named and the scores are listed', async () => {
    const msgs = table((g) => { g.phase = 'gameOver'; g.winner = 0; g.sunk = [5, 2]; });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.overlay .sheet h2').count(), 1);
    assert.match(await page.locator('.overlay .sheet h2').innerText(), /You won/);
    await ctx.close();
  });

  await test('a watcher sees both seas and has no controls', async () => {
    const { page, ctx } = await open(table(undefined, { viewer: 'nobody' }));
    assert.equal(await page.locator('.sb-board').count(), 2);
    assert.equal(await page.locator('[data-sb="fire"], [data-sb="clear"], .sb-tabs').count(), 0);
    assert.match(await page.locator('.wz-status').innerText(), /Watching/);
    await ctx.close();
  });

  await test('while placing, my sea is a grid of 100 squares, five ship buttons, and Ready is off until all five are placed', async () => {
    const { page, ctx } = await open(table(undefined, { placing: true }));
    assert.equal(await page.locator('.sb-board.mine button.sb-cell').count(), 100);
    assert.equal(await page.locator('.sb-chip').count(), 5);
    assert.equal(await page.locator('[data-sb="ready"]').isDisabled(), true);
    assert.equal(await page.locator('.sb-tabs').count(), 0, 'no tabs while placing');
    await ctx.close();
  });

  await test('Random sends a random placement; Ready sends ready once the fleet is complete', async () => {
    const { page, ctx } = await open(table(undefined, { placing: true }));
    await page.locator('[data-sb="random"]').click();
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'random' });
    await ctx.close();
    const full = await open(table(undefined, { placed: true }));
    await full.page.locator('[data-sb="ready"]').click();
    assert.deepEqual((await sent(full.page)).at(-1).action, { type: 'ready' });
    await full.ctx.close();
  });

  await test('a ship is chosen, then a square sends where its first square goes; a square that touches another ship sends nothing', async () => {
    const { page, ctx } = await open(table(undefined, { placed: true }));
    await page.locator('.sb-chip').nth(0).click();   // the first ship is already placed; pick it up and move it along row 0
    await page.locator('.sb-board.mine button.sb-cell').nth(5).click();
    const move = (await sent(page)).at(-1).action;
    assert.equal(move.type, 'place');
    assert.deepEqual(move.ships[0], { r: 0, c: 5, vertical: false });
    const count = (await sent(page)).length;
    await page.locator('.sb-chip').nth(1).click();   // the second ship: its first square at (3,2) would touch the ship on row 2
    await page.locator('.sb-board.mine button.sb-cell').nth(32).click();
    assert.equal((await sent(page)).length, count, 'a touching square sends nothing');
    assert.match(await page.locator('.wz-status').innerText(), /touch/);
    await ctx.close();
  });

  await test('Rotate changes the direction of the ship being placed', async () => {
    const { page, ctx } = await open(table(undefined, { placing: true }));
    await page.locator('.sb-chip').nth(0).click();
    const before = await page.locator('[data-sb="rotate"]').innerText();
    await page.locator('[data-sb="rotate"]').click();
    assert.notEqual(await page.locator('[data-sb="rotate"]').innerText(), before);
    await page.locator('.sb-board.mine button.sb-cell').nth(0).click();
    assert.equal((await sent(page)).at(-1).action.ships[0].vertical, true, 'the ship is placed down the sea');
    await ctx.close();
  });

  await test('a placed fleet is drawn as five ship hulls on my sea, while placing and in play', async () => {
    const { page, ctx } = await open(table(undefined, { placed: true }));
    assert.equal(await page.locator('.sb-board.mine .sb-hull').count(), 5, 'my own ships show while I place them');
    await ctx.close();
    const playing = await open(table());
    assert.equal(await playing.page.locator('.sb-board.mine .sb-hull').count(), 5, 'five hulls once the game is on');
    await playing.ctx.close();
  });

  await test('the placing screen fits a 360 px phone, with no sideways scroll and buttons at least 44 px tall', async () => {
    const { page, ctx } = await open(table(undefined, { placing: true }), { width: 360, height: 640 });
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= 360, `page is ${scroll}px wide`);
    for (const sel of ['[data-sb="random"]', '[data-sb="ready"]', '.sb-chip']) {
      const box = await page.locator(sel).first().boundingBox();
      assert.ok(box.height >= 44, `${sel} is ${box.height}px tall`);
    }
    await ctx.close();
  });

  await test('a placed ship is picked up and Rotate turns it where it is; the turned ship is sent and stays picked up', async () => {
    const { page, ctx } = await open(table(undefined, { placed: true }));
    await page.locator('[data-sb="pick"][data-slot="4"]').click();
    await page.locator('[data-sb="rotate"]').click();
    const act = (await sent(page)).at(-1).action;
    assert.equal(act.type, 'place');
    assert.deepEqual(act.ships[4], { r: 8, c: 0, vertical: true }, 'the destroyer turns down from its square');
    assert.equal(act.ships[0].vertical, false, 'the other ships are not moved');
    await ctx.close();
  });

  await test('two Rotate taps before the next view turn the ship there and back', async () => {
    const { page, ctx } = await open(table(undefined, { placed: true }));
    await page.locator('[data-sb="pick"][data-slot="4"]').click();
    await page.locator('[data-sb="rotate"]').click();
    await page.locator('[data-sb="rotate"]').click();
    const act = (await sent(page)).at(-1).action;
    assert.equal(act.ships[4].vertical, false, 'the second turn returns the destroyer to across');
    await ctx.close();
  });

  await test('a Rotate shows at once on the sea and on the button, before the server view arrives', async () => {
    const { page, ctx } = await open(table(undefined, { placed: true }));
    await page.locator('[data-sb="pick"][data-slot="4"]').click();
    const hullsBefore = await page.locator('.sb-hull.v').count();
    await page.locator('[data-sb="rotate"]').click();
    assert.equal(await page.locator('.sb-hull.v').count(), hullsBefore + 1, 'the destroyer is drawn down at once');
    assert.match(await page.locator('[data-sb="rotate"]').innerText(), /Down/, 'the button says Down');
    await ctx.close();
  });

  await test('Clear, then Rotate before the cleared view arrives, does not send the old fleet back', async () => {
    const { page, ctx } = await open(table(undefined, { placed: true }));
    await page.locator('[data-sb="reset"]').click();
    const before = (await sent(page)).length;
    await page.locator('[data-sb="pick"][data-slot="4"]').click();
    await page.locator('[data-sb="rotate"]').click();
    const after = await sent(page);
    assert.equal(after.length, before, 'nothing more is sent: the cleared ship has no place to turn');
    assert.deepEqual(after.at(-1).action, { type: 'place', ships: Array(5).fill(null) });
    await ctx.close();
  });

  await test('the ✕ in the table toolbar opens the leave prompt (it used to be ignored)', async () => {
    const { page, ctx } = await open(table());
    await page.locator('[data-act="leave"]').click();
    await page.waitForSelector('text=Leave game?', { timeout: 3000 });
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\nsea battle UI: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
