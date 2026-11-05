'use strict';
/**
 * Seeded simulation of every registered game with bots, plus rejected-action probes.
 * Invariants checked for every game, seat count and seed:
 *  - the game finishes (no stuck state, no infinite loop) and bot actions are always accepted
 *  - act() never throws, even for garbage actions straight from the network
 *  - a rejected action changes nothing (the public view is identical before and after)
 *  - a finished game accepts no further actions and awaits nobody
 *  - views are JSON-serialisable for every seat and for a spectator, and never carry another seat's hand
 */
const assert = require('node:assert/strict');
const games = require('../games');

const SEEDS = Number(process.env.SIM_SEEDS || 6);
const STEP_CAP = 20000;
const GARBAGE = [undefined, null, 0, 'x', [], {}, { type: 'nope' }, { type: 'play', card: { suit: 'x', rank: 99 } }, { type: 'bid', amount: -5 }, { type: 'bid', amount: 1e9 }, { type: 'bid', amount: NaN },
  { type: '__proto__' }, { type: 'play', card: null }, { type: 'move', token: 99 }, { type: 'ask', rank: 'Z', target: 99 }, { type: 'bet', amount: 'all' }];

function rngFor(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const names = ['Ann', 'Bo', 'Cy', 'Di', 'Eve', 'Fay', 'Gus', 'Hal'];
// The classic Property Rivals game ("until one player is left") has no money sink, so four bots can circle forever
// (confirmed: seed 3, 4 players, 2,000+ rounds with nobody bankrupt). That is documented in the option text; the
// simulation plays the 60-round variant so it terminates.
const SIM_OPTIONS = { propertyrivals: { rounds: '60' } };
const defaults = (def) => ({ ...Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default])), ...(SIM_OPTIONS[def.id] || {}) });

function checkViews(def, g, players, label) {
  const spectator = g.view('__spectator__');
  assert.doesNotThrow(() => JSON.stringify(spectator), `${label}: spectator view serialises`);
  for (let i = 0; i < players.length; i++) {
    const v = g.view(players[i].id);
    const json = JSON.stringify(v);
    assert.ok(json && json.length < 400000, `${label}: view for seat ${i} is bounded (${json.length} bytes)`);
    // another seat's private hand must never be in the view (a public `cards` list on a showdown is not a "hand")
    if (v && Array.isArray(v.players) && !g.isOver()) {
      v.players.forEach((p, j) => { if (j !== i && p && Array.isArray(p.hand) && p.hand.length) assert.fail(`${label}: seat ${i} is sent seat ${j}'s hand`); });
    }
  }
}

let games_run = 0;
for (const entry of games.list()) {
  const def = games.get(entry.id);
  const counts = [...new Set([def.seats.min, def.seats.default, def.seats.max])];
  for (const n of counts) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const label = `${def.id}/${n}p/seed${seed}`;
      const players = names.slice(0, n).map((name, i) => ({ id: 'p' + i, name }));
      const rng = rngFor(seed * 7919 + n);
      const g = def.create(players, defaults(def), rng);
      const ready = () => { for (const p of players) g.act(p.id, { type: 'ready' }); }; // some games open with a ready step
      if (g.awaiting().length === players.length && def.id === 'ludo') ready();
      let steps = 0;
      const probe = rngFor(seed);
      while (!g.isOver()) {
        assert.ok(++steps < STEP_CAP, `${label}: stuck after ${STEP_CAP} steps`);
        const aw = g.awaiting();
        // a garbage action from the awaited seat, a random seat and the server must be rejected without side effects
        if (steps % 11 === 0) {
          const who = [aw[0], players[Math.floor(probe() * n)].id, null, 'stranger'][steps % 4];
          const before = JSON.stringify(g.view(players[0].id));
          const bad = GARBAGE[Math.floor(probe() * GARBAGE.length)];
          let res;
          assert.doesNotThrow(() => { res = g.act(who, bad); }, `${label}: act(${JSON.stringify(bad)}) threw`);
          if (res && res.ok === false) assert.equal(JSON.stringify(g.view(players[0].id)), before, `${label}: a rejected action changed the game`);
          if (res && res.ok) continue; // a garbage action that happened to be legal (e.g. an empty "ready"): fine, keep going
        }
        if (!aw.length) {
          const auto = g.autoAction && g.autoAction();
          assert.ok(auto, `${label}: nobody is awaited and there is no automatic action (stuck)`);
          const r = g.act(null, auto);
          assert.ok(r && r.ok, `${label}: autoAction was rejected: ${r && r.error}`);
          continue;
        }
        const fp = g.forcedPlay && g.forcedPlay();
        const pid = fp ? fp.playerId : aw[Math.floor(probe() * aw.length)];
        const action = fp ? fp.action : g.botAction(pid);
        assert.ok(action, `${label}: the bot has no action for ${pid}`);
        const r = g.act(pid, action);
        assert.ok(r && r.ok, `${label}: bot action ${JSON.stringify(action)} for ${pid} was rejected: ${r && r.error}`);
        if (steps % 25 === 0) checkViews(def, g, players, label);
      }
      checkViews(def, g, players, label + '/over');
      assert.deepEqual(g.awaiting(), [], `${label}: a finished game awaits nobody`);
      const post = JSON.stringify(g.view(players[0].id));
      for (const p of players) {
        for (const a of [{ type: 'play', card: {} }, { type: 'roll' }, { type: 'bid', amount: 1 }, { type: 'ready' }, { type: 'ask', rank: 'A', target: 'p1' }]) {
          const r = g.act(p.id, a);
          assert.ok(!r || r.ok === false || r.ok === undefined || JSON.stringify(g.view(players[0].id)) === post, `${label}: a finished game changed after ${JSON.stringify(a)}`);
        }
      }
      assert.equal(JSON.stringify(g.view(players[0].id)), post, `${label}: a finished game accepted a further action`);
      games_run++;
    }
  }
}
console.log(`simulation: ${games_run} complete games across ${games.list().length} game types passed`);
