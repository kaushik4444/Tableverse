'use strict';
// The historic replay planner: order, unrated reasons, the pair limit, the daily cap, zero-sum matches and the monthly reset.
// Pure, no database.
const assert = require('node:assert/strict');
const { replay, report, REASON } = require('../lib/ratingReplay');

const part = (playerId, extra = {}) => ({ playerId, isBot: false, leftEarly: false, forfeit: false, isWinner: false, isDraw: false, place: null, score: 0, ...extra });
const match = (id, gameId, finishedAt, participants, extra = {}) => ({ id, gameId, finishedAt, completed: true, matchKey: 'key-' + id, participants, ...extra });
const sumScope = (events, scope) => events.filter((e) => e.scope === scope).reduce((s, e) => s + e.delta, 0);
const lifetimeEvent = (result, playerId) => result.events.find((e) => e.playerId === playerId && e.scope === 'lifetime');

const T = (h) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();

// 1. the input order does not change the result
{
  const ms = [
    match('m1', 'chess', T(9), [part('A', { isWinner: true }), part('B')]),
    match('m2', 'chess', T(10), [part('B', { isWinner: true }), part('C')]),
    match('m3', 'chess', T(11), [part('A'), part('C', { isWinner: true })]),
  ];
  const a = replay(ms);
  const b = replay([...ms].reverse());
  assert.deepEqual(a, b, 'the replay sorts by finish time, so input order does not matter');
}

// 2. a rated 1v1 match is zero-sum in each scope, and both scopes are recorded
{
  const r = replay([match('m1', 'chess', T(9), [part('A', { isWinner: true }), part('B')])]).results[0];
  assert.equal(r.rated, true);
  assert.ok(Math.abs(sumScope(r.events, 'lifetime')) < 1e-9, 'lifetime changes add up to 0');
  assert.ok(Math.abs(sumScope(r.events, '2026-11')) < 1e-9, 'monthly changes add up to 0');
  assert.equal(r.events.length, 4, 'one event per player per scope');
}

// 3. unrated reasons: bots, guests, unfinished, teams, Mind, unverified placings
{
  const reasonOf = (m) => replay([m]).results[0].reason;
  assert.equal(reasonOf(match('bot', 'chess', T(9), [part('A', { isWinner: true }), part(null, { isBot: true })])), 'too-few-players');
  assert.equal(reasonOf(match('guest', 'chess', T(9), [part('A', { isWinner: true }), part(null)])), 'guest');
  assert.equal(reasonOf(match('open', 'chess', T(9), [part('A'), part('B')], { completed: false })), 'unfinished');
  assert.equal(reasonOf(match('team', 'twentynine', T(9), [part('A1'), part('A2'), part('B1'), part('B2')])), REASON.TEAM);
  assert.equal(reasonOf(match('mind', 'themind', T(9), [part('A', { isWinner: true }), part('B', { isWinner: true })])), REASON.COOPERATIVE);
  assert.equal(reasonOf(match('colour', 'colorclash', T(9), [part('A', { score: 5 }), part('B', { score: 3 })])), REASON.RANKING, 'Colour Clash is not checked yet');
  assert.equal(replay([match('ludo', 'ludo', T(9), [part('A', { score: 5 }), part('B', { score: 3 })])]).results[0].rated, true, 'Ludo is verified by its placing');
  // a game that ranks by place needs a stored place for everyone still in the match
  assert.equal(reasonOf(match('poker-no-place', 'poker', T(9), [part('A', { place: 1, score: 9 }), part('B', { score: 3 })])), REASON.RANKING);
  assert.equal(replay([match('poker-ok', 'poker', T(9), [part('A', { place: 1 }), part('B', { place: 2 })])]).results[0].rated, true);
  assert.equal(replay([match('wiz', 'wizard', T(9), [part('A', { score: 5 }), part('B', { score: 3 })])]).results[0].rated, true, 'Wizard is verified by score');
}

// 4. a leave before forfeits were recorded is unrated; after, a penalised leave loses against everyone still in
{
  const left = (t) => match('l', 'chess', t, [part('A', { isWinner: true }), part('B', { leftEarly: true, forfeit: false }), part('C')]);
  const before = replay([left(T(9))], { forfeitRecordedSince: '2026-12-01T00:00:00Z' }).results[0];
  assert.equal(before.reason, REASON.LEAVE);
  const penalised = match('p', 'chess', T(9), [part('A', { isWinner: true }), part('B', { leftEarly: true, forfeit: true }), part('C')]);
  const after = replay([penalised], { forfeitRecordedSince: '2026-12-01T00:00:00Z' }).results[0];
  assert.equal(after.rated, true);
  assert.ok(lifetimeEvent(after, 'B').delta < 0, 'the penalised leaver loses rating');
  assert.ok(Number.isFinite(lifetimeEvent(after, 'B').after), 'no infinite rating');
  assert.ok(Math.abs(sumScope(after.events, 'lifetime')) < 1e-9, 'still zero-sum with a leaver');
}

// 5. pair limit: the 4th and 5th matches of the same pair in 24 hours count at half, the 6th not at all
{
  const ms = [0, 1, 2, 3, 4, 5].map((i) => match('pair' + i, 'chess', T(9 + i * 0.1), [part('A', { isWinner: i % 2 === 0 }), part('B', { isWinner: i % 2 !== 0 })]));
  const rs = replay(ms).results;
  assert.ok(Math.abs(lifetimeEvent(rs[0], 'A').delta) > 1, 'the first match counts');
  assert.ok(lifetimeEvent(rs[3], 'A').delta !== 0, 'the 4th match still counts (at half)');
  assert.equal(rs[5].rated, false, 'the 6th match in 24 hours is not rated');
  assert.equal(rs[5].reason, REASON.PAIR_LIMIT);
}

// 6. daily cap: one player cannot gain more than the cap in one UTC day, against different opponents
{
  const ms = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => match('cap' + i, 'chess', T(9 + i * 0.5), [part('A', { isWinner: true }), part('X' + i)]));
  const rs = replay(ms).results;
  const total = rs.reduce((s, r) => s + lifetimeEvent(r, 'A').delta, 0);
  assert.ok(total <= 60 + 1e-9, `A gains at most the daily cap (got ${total.toFixed(1)})`);
  assert.ok(total > 50, 'A does reach the cap');
}

// 7. monthly ratings start from 1000 each UTC month
{
  const ms = [
    match('nov', 'chess', '2026-11-30T23:00:00Z', [part('A', { isWinner: true }), part('B')]),
    match('dec', 'chess', '2026-12-01T01:00:00Z', [part('A', { isWinner: true }), part('C')]),
  ];
  const rs = replay(ms).results;
  const decA = rs[1].events.find((e) => e.playerId === 'A' && e.scope === '2026-12');
  assert.equal(decA.before, 1000, 'the December rating starts at 1000');
  const lifeA = rs[1].events.find((e) => e.playerId === 'A' && e.scope === 'lifetime');
  assert.ok(lifeA.before > 1000, 'lifetime carries on from November');
}

// 8. the report counts rated and unrated matches per game, with the reasons
{
  const ms = [
    match('a', 'chess', T(9), [part('A', { isWinner: true }), part('B')]),
    match('b', 'colorclash', T(10), [part('A'), part('B')]),
    match('c', 'colorclash', T(11), [part('A'), part('B')]),
  ];
  const rep = report(replay(ms).results);
  assert.equal(rep.chess.rated, 1);
  assert.equal(rep.colorclash.unrated, 2);
  assert.equal(rep.colorclash.reasons[REASON.RANKING], 2);
}

// 9. a match with no stored match key (written before results were reported) is unrated: its winners are unknown
{
  const legacy = match('old', 'chess', T(9), [part('A', { isWinner: true }), part('B')], { matchKey: null });
  assert.equal(replay([legacy]).results[0].reason, REASON.LEGACY);
}

// 10. the daily cap keeps each match zero-sum: one capped player scales the whole match, the other side loses the same
{
  // A has already moved +59 today in chess, then wins against a fresh opponent: the win is cut to +1 for A and
  // B's loss is cut by the same factor, so the two changes still add up to zero.
  const ms = [0, 1].map((i) => match('warm' + i, 'chess', T(9 + i * 0.5), [part('A', { isWinner: true }), part('W' + i)]));
  const later = match('cap-zs', 'chess', T(12), [part('A', { isWinner: true }), part('B')]);
  const rs = replay([...ms, later]).results;
  const capped = rs[2];
  assert.ok(Math.abs(sumScope(capped.events, 'lifetime')) < 1e-9, 'a capped match is still zero-sum');
  assert.ok(Math.abs(sumScope(capped.events, '2026-11')) < 1e-9, 'and in the month too');
  const total = rs.reduce((s, r) => s + lifetimeEvent(r, 'A').delta, 0);
  assert.ok(total <= 60 + 1e-9, `A's day total stays within the cap (got ${total.toFixed(2)})`);
}

// 11. when every pair has used up the 24-hour limit, the match is unrated with reason pair-limit, and it still counts
{
  const ms = [0, 1, 2, 3, 4, 5, 6].map((i) => match('pl' + i, 'chess', T(9 + i * 0.1), [part('A', { isWinner: i % 2 === 0 }), part('B', { isWinner: i % 2 !== 0 })]));
  const rs = replay(ms).results;
  assert.equal(rs[6].rated, false);
  assert.equal(rs[6].reason, REASON.PAIR_LIMIT);
  assert.equal(rs[5].reason, REASON.PAIR_LIMIT, 'the 6th match of the pair is suppressed too');
  assert.equal(rs[4].rated, true, 'the 5th match is still rated (at half)');
}

console.log('rating replay: all tests passed');

// 4. a match with bots is rated among its humans; the bot seat gets no rating event
{
  const r = replay([match('m1', 'chess', T(9), [part('A', { isWinner: true }), part('B'), part('C'), part(null, { isBot: true })])]).results[0];
  assert.equal(r.rated, true, 'three humans and a bot are rated');
  assert.ok(!r.events.some((e) => e.playerId === 'guest:' || e.playerId === 'null' || e.playerId === null), 'no event for the bot');
  assert.deepEqual([...new Set(r.events.map((e) => e.playerId))].sort(), ['A', 'B', 'C'], 'the humans get the events');
  assert.ok(Math.abs(sumScope(r.events, 'lifetime')) < 1e-9, 'still zero-sum among the humans');
}
