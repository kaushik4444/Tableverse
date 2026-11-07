'use strict';
// Wizard hidden and secret bids: no bid amount may reach any client-visible payload before the reveal the variant
// describes. The checks read the serialized output of the game adapter (what spectators, players and reconnects receive),
// not only the structured `bid` field.
const assert = require('node:assert/strict');
const W = require('../games/wizard');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));

// Everything a client could receive about this game: the spectator view, every seat's view, and the bids in each.
const payloads = (g, n) => [g.view(null), ...Array.from({ length: n }, (_, i) => g.view('p' + i))].map((v) => JSON.stringify(v));
const anyPayload = (g, n, re) => payloads(g, n).some((s) => re.test(s));

// Round 1 deals one card each, so every bid of 1 is legal.
function settleTrump(g, n) {
  for (let i = 0; i < n; i++) if (g.act('p' + i, { type: 'chooseTrump', suit: 'R' }).ok) return;
}
// Exactly one bid per seat; after the last one the awaiting list shows the first player to play, so stop there.
function bidRound1(g, n, onBid) {
  settleTrump(g, n);
  let made = 0;
  for (let guard = 0; guard < 20 && made < n; guard++) {
    for (const id of g.awaiting()) {
      if (made >= n) break;
      const r = g.act(id, { type: 'bid', amount: 1 });
      assert.equal(r.ok, true, r.error);
      made++;
      if (onBid) onBid(id);
    }
  }
  assert.equal(made, n, 'every seat bid');
}
// Plays until the round is over (the adapter's autoAction offers 'continue' only at roundEnd).
function playToRoundEnd(g, onStep) {
  for (let guard = 0; guard < 500 && !g.autoAction(); guard++) {
    if (onStep) onStep();
    const ids = g.awaiting();
    if (!ids.length) break;
    for (const id of ids) {
      const r = g.act(id, g.botAction(id));
      assert.equal(r.ok, true, r.error);
    }
  }
  assert.ok(g.autoAction(), 'round reached its end');
}

const LEAKED_BID = /P\d bids? \d/; // a bid amount written in the public log
const REVEALED_BID = (name, amt) => `${name} bid ${amt}`;

console.log('wizard bid privacy');

test('hidden prediction: no bid amount is in any payload before the bids are revealed, and the table sees that someone bid', () => {
  const n = 3;
  const g = W.create(players(n), { variant: 'hidden' }, mulberry32(21));
  settleTrump(g, n);
  assert.equal(g.act('p1', { type: 'bid', amount: 1 }).ok, true);
  assert.equal(g.act('p1', { type: 'bid', amount: 1 }).ok, false, 'a bid can only be made once');
  assert.equal(anyPayload(g, n, LEAKED_BID), false, 'no amount in the log while others are still bidding');
  // the bidder's own view legitimately shows their own bid; every other client must not see it in any field
  const others = [g.view(null), g.view('p0'), g.view('p2')].map((v) => JSON.stringify(v));
  assert.equal(others.some((s) => /"bid":1\b/.test(s)), false, 'no amount in any structured bid field for anyone else');
  assert.ok(payloads(g, n).every((s) => s.includes('P1 has bid')), 'everyone is told that P1 has bid');
  assert.equal(g.view('p0').players[1].bid, null, 'others’ bids are masked for player 0');
  assert.equal(g.view(null).players[1].bid, null, 'spectators do not see the bid');
  // when the last bid is in, every bid is revealed together, just before the round starts
  g.act('p0', { type: 'bid', amount: 0 });
  assert.equal(anyPayload(g, n, LEAKED_BID), false, 'still hidden with one bid outstanding');
  g.act('p2', { type: 'bid', amount: 0 });
  assert.ok(payloads(g, n).every((s) => s.includes(REVEALED_BID('P1', 1))), 'after the reveal everyone sees P1 bid 1');
  assert.ok(payloads(g, n).every((s) => s.includes(REVEALED_BID('P0', 0))), 'and P0 bid 0');
});

test('secret prediction: no bid amount is in any payload until the round ends, then every bid is shown', () => {
  const n = 3;
  const g = W.create(players(n), { variant: 'secret' }, mulberry32(4));
  bidRound1(g, n);
  assert.equal(g.autoAction(), null, 'round is in play');
  assert.equal(anyPayload(g, n, LEAKED_BID), false, 'no amount during the play of the round');
  assert.ok(payloads(g, n).every((s) => s.includes('has bid')), 'the table sees that bids were made');
  assert.equal(g.view('p0').players[1].bid, null, 'others’ bids stay masked');
  assert.equal(g.view('p0').players[0].bid, 1, 'your own bid is visible to you');
  playToRoundEnd(g, () => assert.equal(anyPayload(g, n, LEAKED_BID), false, 'no amount at any step of the round'));
  for (let i = 0; i < n; i++) assert.ok(payloads(g, n).every((s) => s.includes(REVEALED_BID('P' + i, 1))), `after the round, P${i} bid 1 is shown`);
});

test('visible bidding is unchanged: the bid is in the public log as soon as it is made', () => {
  const n = 3;
  const g = W.create(players(n), { variant: 'none' }, mulberry32(9));
  bidRound1(g, n, (id) => {
    const bidder = id;
    assert.ok(payloads(g, n).every((s) => s.includes(`${bidder.replace('p', 'P')} bids 1`)), `${bidder} bid is public`);
  });
});

test('a reconnecting player receives the same masking as everyone else, and nothing extra', () => {
  const n = 4;
  const g = W.create(players(n), { variant: 'hidden' }, mulberry32(33));
  settleTrump(g, n);
  g.act('p2', { type: 'bid', amount: 1 });
  const back = g.view('p2'); // the view a reconnecting player is sent
  assert.equal(back.players[2].bid, 1, 'your own bid is shown to you');
  for (let i = 0; i < n; i++) if (i !== 2) assert.equal(back.players[i].bid, null, `P${i}'s bid is not sent to P2`);
  assert.equal(anyPayload(g, n, LEAKED_BID), false, 'and the log carries no amount');
});

console.log(`${passed} wizard bid privacy checks passed`);
