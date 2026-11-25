'use strict';
// The incremental ratings rebuild must give exactly what a full replay gives. This simulates the stored ledger in memory:
// matches arrive in random batches, each batch is replayed from a window whose starting state comes from the ledger
// (lib/ratingReplay.js: seedForWindow, seedDayTotals, pairHistory), and the result is compared with one full replay of the
// whole history. A window with a stored match that does not replay the same way is reported, and the job falls back to a full
// rebuild. Pure, no database.
const assert = require('node:assert/strict');
const { replay, seedForWindow, seedDayTotals, pairHistory } = require('../lib/ratingReplay');
const { DAILY_CAP } = require('../lib/ratings');

const DAY_MS = 24 * 60 * 60 * 1000;
const part = (playerId, extra = {}) => ({ playerId, isBot: false, leftEarly: false, forfeit: false, isWinner: false, isDraw: false, place: null, score: 0, ...extra });
const match = (id, gameId, finishedMs, participants) => ({ id, gameId, finishedAt: new Date(finishedMs).toISOString(), completed: true, matchKey: 'key-' + id, participants, finishedMs });

// a small deterministic generator, so a failure can be reproduced
function generator(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// a history: several players, two games, bursts of matches between the same pair, and gaps of more than a day
function history(seed, count = 90) {
  const rnd = generator(seed);
  const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const games = ['chess', 'tictactoe'];
  const out = [];
  let t = Date.UTC(2026, 10, 1, 8);
  for (let i = 0; i < count; i += 1) {
    const roll = rnd();
    t += roll < 0.3 ? 20 * 60 * 1000 : roll < 0.8 ? 3 * 60 * 60 * 1000 : 26 * 60 * 60 * 1000;
    const a = players[Math.floor(rnd() * players.length)];
    let b = players[Math.floor(rnd() * players.length)];
    if (b === a) b = players[(players.indexOf(a) + 1) % players.length];
    const gameId = games[Math.floor(rnd() * games.length)];
    const winner = rnd() < 0.5 ? a : b;
    out.push(match('m' + String(i).padStart(3, '0'), gameId, t, [part(a, { isWinner: winner === a }), part(b, { isWinner: winner === b })]));
  }
  return out;
}

const byTime = (x, y) => x.finishedMs - y.finishedMs || String(x.id).localeCompare(String(y.id));
const keyOf = (playerId, gameId, scope) => `${playerId}|${gameId}|${scope}`;

// The stored ledger: the rated flag and reason per match, the ledger rows, and the current rating per player, game and scope.
function emptyStore() { return { processed: new Map(), events: [], ratings: new Map() }; }

function store(results, finishedById, st) {
  for (const r of results) {
    st.processed.set(r.id, { rated: r.rated, reason: r.reason });
    for (const e of r.events) st.events.push({ matchId: r.id, playerId: e.playerId, gameId: r.gameId, scope: e.scope, delta: e.delta, before: e.before, after: e.after, finishedMs: finishedById.get(r.id) });
  }
}

function storeRatings(ratings, st) {
  for (const r of ratings) st.ratings.set(keyOf(r.playerId, r.gameId, r.scope), { rating: r.rating, ratedGames: r.ratedGames });
}

// the window the database job reads for a batch of new matches, and the seeds it builds from the ledger
function windowFor(st, all, newIds, finishedById) {
  const oldest = Math.min(...newIds.map((id) => finishedById.get(id)));
  const dayStart = new Date(oldest); dayStart.setUTCHours(0, 0, 0, 0);
  const since = Math.min(oldest - DAY_MS, dayStart.getTime());
  const window = all.filter((m) => m.finishedMs >= since);
  const players = new Set(window.flatMap((m) => m.participants.map((p) => p.playerId)));
  const current = [...st.ratings.entries()].filter(([k]) => players.has(k.split('|')[0])).map(([k, v]) => {
    const [playerId, gameId, scope] = k.split('|');
    return { playerId, gameId, scope, rating: v.rating, ratedGames: v.ratedGames };
  });
  const mine = st.events.filter((e) => players.has(e.playerId));
  const windowEvents = mine.filter((e) => e.finishedMs >= since);
  const counts = new Map();
  for (const e of mine) if (e.finishedMs < since) counts.set(keyOf(e.playerId, e.gameId, e.scope), (counts.get(keyOf(e.playerId, e.gameId, e.scope)) || 0) + 1);
  const priorCounts = [...counts].map(([k, count]) => { const [playerId, gameId, scope] = k.split('|'); return { playerId, gameId, scope, count }; });
  const sinceDay = new Date(since); sinceDay.setUTCHours(0, 0, 0, 0);
  const dayEvents = mine.filter((e) => e.finishedMs >= sinceDay.getTime() && e.finishedMs < since);
  const priorMatches = all
    .filter((m) => m.finishedMs >= since - DAY_MS && m.finishedMs < since && st.processed.has(m.id))
    .map((m) => ({ ...m, rated: st.processed.get(m.id).rated, reason: st.processed.get(m.id).reason }));
  const seed = {
    state: seedForWindow({ current, windowEvents, priorCounts }),
    dayTotals: seedDayTotals(dayEvents),
    pairTimes: pairHistory(priorMatches),
  };
  return { window, seed };
}

// the rebuild the database job does for one batch of new matches. Returns false when a stored match would not replay the
// same way (the job then runs a full rebuild instead).
function incrementalBatch(st, all, newIds, finishedById) {
  const { window, seed } = windowFor(st, all, newIds, finishedById);
  const { results, ratings } = replay(window, { forfeitRecordedSince: null, teamsRecorded: false, seed: seed.state, dayTotals: seed.dayTotals, pairTimes: seed.pairTimes });
  const signature = (events) => events.map((e) => `${e.playerId}|${e.scope}|${e.delta}|${e.before}|${e.after}`).sort().join(';');
  for (const r of results) {
    if (!st.processed.has(r.id)) continue;
    const stored = st.events.filter((e) => e.matchId === r.id).map((e) => ({ playerId: e.playerId, scope: e.scope, delta: e.delta, before: e.before, after: e.after }));
    if (signature(r.events) !== signature(stored) || r.rated !== st.processed.get(r.id).rated) return false;
  }
  store(results.filter((r) => newIds.includes(r.id)), finishedById, st);
  storeRatings(ratings, st);
  return true;
}

function simulate(seed, sizeOf) {
  const all = history(seed).sort(byTime);
  const finishedById = new Map(all.map((m) => [m.id, m.finishedMs]));
  const st = emptyStore();
  // the first rebuild is a full one; after that, each batch of later matches is incremental
  const full = replay(all.slice(0, 5), { forfeitRecordedSince: null, teamsRecorded: false });
  store(full.results, finishedById, st);
  storeRatings(full.ratings, st);
  const rnd = generator(seed + 7);
  for (let i = 5; i < all.length;) {
    const size = sizeOf(rnd);
    const batch = all.slice(i, i + size).map((m) => m.id);
    // only the matches written so far are in the database: the window cannot see later matches
    assert.ok(incrementalBatch(st, all.slice(0, i + size), batch, finishedById), `seed ${seed}: a batch fell back to a full rebuild`);
    i += size;
  }
  return { all, st };
}

const sig = (events) => events.map((e) => `${e.playerId}|${e.scope}|${e.delta}|${e.before}|${e.after}`).sort().join(';');

for (const seed of [1, 2, 3, 42, 99]) {
  for (const size of [1, 3, 7]) {
    const { all, st } = simulate(seed, () => size);
    const whole = replay(all, { forfeitRecordedSince: null, teamsRecorded: false });
    const label = `seed ${seed}, batches of ${size}`;
    const want = new Map(whole.ratings.map((r) => [keyOf(r.playerId, r.gameId, r.scope), { rating: r.rating, ratedGames: r.ratedGames }]));
    assert.deepEqual([...st.ratings.keys()].sort(), [...want.keys()].sort(), `${label}: the same players, games and scopes`);
    for (const [k, w] of want) {
      assert.equal(st.ratings.get(k).rating, w.rating, `${label}: ${k} rating is exact`);
      assert.equal(st.ratings.get(k).ratedGames, w.ratedGames, `${label}: ${k} games are exact`);
    }
    for (const r of whole.results) {
      const got = st.events.filter((e) => e.matchId === r.id).map((e) => ({ playerId: e.playerId, scope: e.scope, delta: e.delta, before: e.before, after: e.after }));
      assert.equal(sig(got), sig(r.events), `${label}: match ${r.id} has the same ledger rows`);
      assert.equal(st.processed.get(r.id).rated, r.rated, `${label}: match ${r.id} has the same rated flag`);
    }
  }
}
console.log('  ok  incremental batches give exactly the full replay (ratings, games, ledger rows and rated flags), for several histories and batch sizes');
{
  // The window starts at 08:00 UTC on day one. Three earlier wins use most of the daily allowance;
  // replaying the already processed fourth win must reach the same cap without falling back to a full rebuild.
  const all = [1, 2, 3, 10, 32].map((hour, i) => match('cap-' + i, 'chess', Date.UTC(2026, 10, 1, hour),
    [part('winner', { isWinner: true }), part('opponent-' + i)]));
  const finishedById = new Map(all.map((m) => [m.id, m.finishedMs]));
  const st = emptyStore();
  const initial = replay(all.slice(0, 4));
  store(initial.results, finishedById, st);
  storeRatings(initial.ratings, st);
  const dayDeltas = st.events.filter((e) => e.playerId === 'winner' && e.scope === 'lifetime');
  assert.equal(dayDeltas.reduce((sum, e) => sum + e.delta, 0), DAILY_CAP);
  assert.ok(dayDeltas[3].delta > 0 && dayDeltas[3].delta < dayDeltas[2].delta, 'the fourth win is clipped by the daily cap');
  assert.ok(incrementalBatch(st, all, [all[4].id], finishedById), 'the stored capped match replays with the seeded totals');
  const full = replay(all);
  assert.equal(sig(st.events.filter((e) => e.matchId === all[4].id)), sig(full.results[4].events));
}
console.log('incremental ratings: all passed');
