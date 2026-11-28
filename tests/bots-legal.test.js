'use strict';
// Bots in every game: each game the bots play finishes, every bot move is accepted, and the shared slip helper behaves.
// Each game is played with its default options and its default seat count, from one fixed seed. Property Rivals with
// "Until one player is left" is skipped: that classic mode is allowed to run very long (its option text says so).
const assert = require('node:assert/strict');
const registry = require('../games');
const { SLIP, slips, pickOne } = require('../games/botSkill');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

test('the slip helper: the rate is the one set in botSkill, and pickOne returns a member of the list', () => {
  let seed = 9;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let hits = 0;
  for (let i = 0; i < 20000; i++) if (slips(rng)) hits++;
  assert.ok(Math.abs(hits / 20000 - SLIP) < 0.02, `slip rate ${hits / 20000} is near ${SLIP}`);
  const list = ['a', 'b', 'c'];
  for (let i = 0; i < 50; i++) assert.ok(list.includes(pickOne(rng, list)));
});

test('every game finishes when only bots play its default options, and every bot move is accepted', () => {
  const seed0 = 41;
  for (const mod of registry.list()) {
    const id = mod.id;
    if (id === 'propertyrivals') continue; // "Until one player is left" can run very long by design
    const reg = registry.get(id);
    const n = reg.seats.default;
    const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Bot ${i + 1}`, bot: true }));
    const defaults = {};
    for (const o of reg.options || []) defaults[o.key] = o.default;
    let seed = seed0 + id.length;
    const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
    const g = reg.create(players, defaults, rng);
    let steps = 0;
    while (!g.isOver() && steps < 20000) {
      steps++;
      const aw = g.awaiting();
      if (!aw.length) {
        const auto = g.autoAction && g.autoAction();
        if (!auto) break;
        const r = g.act(null, auto);
        assert.ok(r && r.ok, `${id}: an automatic play was refused: ${r && r.error}`);
        continue;
      }
      for (const pid of aw) {
        if (g.isOver()) break;
        if (!g.awaiting().includes(pid)) continue;
        const action = g.botAction(pid);
        const r = g.act(pid, action);
        assert.ok(r && r.ok, `${id}: bot move ${JSON.stringify(action)} was refused: ${r && r.error}`);
      }
    }
    assert.ok(g.isOver(), `${id}: the bots did not finish a game in ${steps} steps`);
  }
});

console.log(`\n${passed} bot tests passed`);
