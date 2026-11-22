'use strict';
require('./helpers/env');
// 29's double and redouble can be answered by either player on the answering side. With a bot as that player's partner, the
// server must not let the bot answer for the side while the connected human can still decide. In memory mode, no database.
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const db = require('../db/pool');
const dbPlayers = require('../db/players');
const { start } = require('../server');
const { sessionSocket } = require('./helpers/auth');

const guard = setTimeout(() => { console.error('FAIL challenge automation test timed out'); process.exit(1); }, 90000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
const quiet = () => ({ log() {}, warn() {}, error() {} });

function socketFor(port, token, onState = () => {}) {
  const c = { id: null, room: null, view: null, phases: [], ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.on('open', () => c.send({ t: 'hello' }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') c.id = m.id;
    if (m.t === 'left') { c.room = null; c.view = null; }
    if (m.t === 'state') { c.room = m.room; c.view = m.view; if (m.view && m.view.phase) c.phases.push(m.view.phase + (m.view.myTurn ? ':mine' : '')); onState(c); }
    if (m.t === 'state' && c.room && c.room.gate && !(c.room.gate.ready || []).includes(c.id)) c.send({ t: 'ready' }); // the start and round gates need every person to press Ready
  });
  return c;
}
async function until(fn, label, ms = 15000) { // the first round waits for Ready from everybody, and CI runners are slower
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(5); }
}

(async () => {
  if (db.hasDatabase()) { console.log('challenge automation (memory) checks skipped: DATABASE_URL is set'); return; }
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet(), sessionCheckMs: 40, env: { ...process.env } });
  // test-only: registered-player behaviour in memory mode (see helpers/openGuestFeatures.js)
  require('./helpers/openGuestFeatures')();
  const { rawToken } = await dbPlayers.createAnonymousPlayer({ displayName: 'Ann', avatar: '🧙' });
  const ann = socketFor(srv.port, rawToken);
  try {
    await until(() => ann.id, 'welcome');
    await test('a bot partner does not answer the double while the connected human can decide', async () => {
      // Who wins the bid is random: play tables until the human's side is the one asked, then check it stays open.
      let found = false;
      for (let attempt = 0; attempt < 30 && !found; attempt++) {
        ann.phases.length = 0;
        ann.send({ t: 'create', gameId: 'twentynine', visibility: 'private', options: { doubleChallenge: true } });
        await until(() => ann.room && ann.room.members.some((m) => m.id === ann.id), 'table');
        for (let i = 0; i < 3; i++) ann.send({ t: 'addBot' });
        await until(() => ann.room.members.length === 4, 'three bots');
        ann.send({ t: 'start' });
        // If the human is the one asked to bid, nobody else can move until she does: leave this table and try another one.
        let askedToBid = false;
        await until(() => {
          if (ann.view && ann.view.phase === 'bidding' && ann.view.myTurn) { askedToBid = true; return true; }
          return ann.phases.some((p) => p.startsWith('challenge') || p === 'playing' || p.startsWith('playing'));
        }, 'the auction ends', 15000); // CI runners are slower than a laptop: the budget is the same as the other waits
        if (askedToBid) {
          ann.send({ t: 'leave' });
          await until(() => !ann.room, 'left the table');
          continue;
        }
        if (ann.phases.includes('challenge:mine')) {
          found = true;
          await sleep(400); // far longer than a bot's delay here (0 to 3 ms)
          assert.equal(ann.view.phase, 'challenge', 'the challenge is still open for the human');
          assert.equal(ann.view.myTurn, true, 'the human can still answer');
        }
        ann.send({ t: 'leave' });
        await until(() => !ann.room, 'left the table');
      }
      assert.ok(found, 'a table where the human answers the double was reached');
    });
    await test('reclaiming a bot seat restores the timeout during a challenge', async () => {
      const timedSrv = await start({ port: 0, trustProxy: false, botDelay: [150, 1700], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet(), sessionCheckMs: 40, env: { ...process.env } });
      // test-only: registered-player behaviour in memory mode (see helpers/openGuestFeatures.js)
      require('./helpers/openGuestFeatures')();
      const { rawToken: tokenA } = await dbPlayers.createAnonymousPlayer({ displayName: 'Ada', avatar: '🧙' });
      const { rawToken: tokenB } = await dbPlayers.createAnonymousPlayer({ displayName: 'Ben', avatar: '🧙' });
      const bid = (c) => {
        const v = c.view;
        if (c.room && v && v.phase === 'bidding' && v.myTurn) {
          const key = `${v.phase}:${v.turn}:${v.highBid}`;
          if (c.lastAction !== key) { c.lastAction = key; c.send({ t: 'act', action: { type: 'bid', amount: 28 } }); }
        }
      };
      const a = socketFor(timedSrv.port, tokenA, bid);
      const b = socketFor(timedSrv.port, tokenB, bid);
      try {
        await until(() => a.id && b.id, 'both players welcomed');
        a.send({ t: 'create', gameId: 'twentynine', visibility: 'public' });
        await until(() => a.room && a.room.members.some((m) => m.id === a.id), 'first player seated');
        a.send({ t: 'setOptions', options: { doubleChallenge: true, timeLimit: '20', shuffleSeats: false } });
        await until(() => a.room.options && a.room.options.doubleChallenge === true && a.room.options.timeLimit === '20' && a.room.options.shuffleSeats === false, 'configured lobby options');
        b.send({ t: 'join', code: a.room.code });
        await until(() => a.room.members.length === 2, 'second player seated');
        a.send({ t: 'addBot' }); a.send({ t: 'addBot' });
        await until(() => a.room.members.length === 4, 'two bot partners seated');
        a.send({ t: 'start' });
        await until(() => a.view && a.view.phase === 'chooseTrump' && b.view && b.view.phase === 'chooseTrump', 'trump choice', 30000);

        const highBidder = a.view.highBidder;
        const claimant = [a, b].find((c) => c.view.me % 2 === (highBidder + 1) % 2);
        const bidder = [a, b].find((c) => c.view.me === highBidder);
        claimant.send({ t: 'leave' });
        await until(() => bidder.room.members.find((m) => m.id === claimant.id)?.bot, 'answering seat taken by a bot');
        if (bidder) bidder.send({ t: 'act', action: { type: 'chooseTrump', suit: bidder.view.hand[0].suit } });
        await until(() => bidder.view && bidder.view.phase === 'challenge', 'challenge starts');
        assert.equal(bidder.view.myTurn, false, 'the connected human is on the other side');
        assert.equal(bidder.room.members.find((m) => m.id === claimant.id).bot, true, 'the awaited human seat is bot-controlled');

        claimant.send({ t: 'join', code: bidder.room.code });
        await until(() => claimant.view && claimant.view.phase === 'challenge' && claimant.view.myTurn, 'reclaimed seat can answer');
        assert.ok(claimant.room.deadline > Date.now(), 'the challenge has a fresh timeout');
        await until(() => claimant.view && claimant.view.phase !== 'challenge', 'challenge auto-times out', 2000);
      } finally {
        a.ws.close(); b.ws.close(); await timedSrv.close();
      }
    });
  } finally {
    ann.ws.close(); await srv.close(); clearTimeout(guard);
    console.log(`\n${passed} challenge automation checks passed`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
