'use strict';
// Skill ratings (Elo per game): zero-sum matches, eligibility, caps and the monthly scope. Pure, no database.
const assert = require('node:assert/strict');
const r = require('../lib/ratings');

const sum = (obj) => Object.values(obj).reduce((s, v) => s + v, 0);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} expected ${b}, got ${a}`);
const pl = (playerId, rating, value, extra = {}) => ({ playerId, rating, value, ratedGames: 0, ...extra });

// expected score and K
close(r.expectedScore(1000, 1000), 0.5, 'equal ratings give 0.5');
assert.ok(r.expectedScore(1200, 1000) > 0.75, 'a 200-point favourite is expected to win more than 75%');
assert.equal(r.kFor(0), r.K_NEW);
assert.equal(r.kFor(r.NEW_GAMES - 1), r.K_NEW);
assert.equal(r.kFor(r.NEW_GAMES), r.K_BASE);

// 1v1: equal players, a win moves ratings by K/2 each (zero-sum)
{
  const d = r.matchDeltas('tictactoe', [pl('A', 1000, 1), pl('B', 1000, 0)]);
  close(d.A, r.K_NEW / 2, 'winner gains K/2');
  close(d.B, -r.K_NEW / 2, 'loser loses K/2');
  close(sum(d), 0, 'a 1v1 match is zero-sum');
}

// a win over a stronger opponent gains more than a win over a weaker one
{
  const strong = r.matchDeltas('chess', [pl('A', 1000, 1), pl('B', 1200, 0)]).A;
  const weak = r.matchDeltas('chess', [pl('A', 1000, 1), pl('B', 800, 0)]).A;
  assert.ok(strong > weak, 'beating a stronger player is worth more');
}

// a tie between equal players changes nothing
{
  const d = r.matchDeltas('chess', [pl('A', 1000, 0.5), pl('B', 1000, 0.5)]);
  close(d.A, 0, 'tie');
}

// placing game with four players, zero-sum, and the places order the changes
{
  const ps = [pl('A', 1000, -1), pl('B', 1000, -2), pl('C', 1000, -3), pl('D', 1000, -4)];
  const d = r.matchDeltas('wizard', ps);
  close(sum(d), 0, 'four-player placing match is zero-sum');
  assert.ok(d.A > d.B && d.B > d.C && d.C > d.D, 'better places gain more');
}

// the same placement in a 2-player and 6-player game is each worth the same per opponent (no bigger swing with more players)
{
  const two = r.matchDeltas('wizard', [pl('A', 1000, -1), pl('B', 1000, -2)]).A;
  const six = [1, 2, 3, 4, 5, 6].map((p) => pl('P' + p, 1000, -p));
  const sixFirst = r.matchDeltas('wizard', six).P1;
  close(sixFirst, two, 'first place gains the same in a 6-player and a 2-player game with equal ratings');
}

// luck-heavy games carry half the weight
{
  const full = r.matchDeltas('wizard', [pl('A', 1000, 1), pl('B', 1000, 0)]).A;
  const luck = r.matchDeltas('ludo', [pl('A', 1000, 1), pl('B', 1000, 0)]).A;
  close(luck, full / 2, 'ludo is half weight');
}

// team game: teams of two, zero-sum, members on the same team get the same change
{
  const ps = [
    pl('A1', 1000, 1, { teamId: 'X' }),
    pl('A2', 1000, 1, { teamId: 'X' }),
    pl('B1', 1000, 0, { teamId: 'Y' }),
    pl('B2', 1000, 0, { teamId: 'Y' }),
  ];
  const d = r.matchDeltas('twentynine', ps);
  close(d.A1, d.A2, 'team members share the change');
  close(sum(d), 0, 'team match is zero-sum (equal teams)');
  assert.ok(d.A1 > 0 && d.B1 < 0, 'the winning team gains');
}

// cooperative: all share the outcome, against the reference (not zero-sum by design)
{
  const won = r.matchDeltas('themind', [pl('A', 1000, 1), pl('B', 1000, 1)]);
  close(won.A, won.B, 'cooperative: everyone gets the same change');
  assert.ok(won.A > 0, 'a cleared table gains against the 1000 reference');
  const lost = r.matchDeltas('themind', [pl('A', 1000, 0), pl('B', 1000, 0)]);
  assert.ok(lost.A < 0, 'a lost table loses');
}

// a single player has nobody to play against
{
  const d = r.matchDeltas('chess', [pl('A', 1000, 1)]);
  close(d.A, 0, 'no opponents, no change');
}

// penalised leave: the leaver is the lowest value, so they lose against everyone still in
{
  const parts = [
    { playerId: 'A', isWinner: true, place: 1 },
    { playerId: 'B', isWinner: false, place: 2 },
    { playerId: 'C', leftEarly: true, forfeit: true, place: 3 },
  ];
  const e = r.eligibility(parts, { finished: true });
  assert.equal(e.rated, true);
  const ps = e.players.map((p) => ({ playerId: p.playerId, rating: 1000, ratedGames: 0, value: r.valueOf(p) }));
  const d = r.matchDeltas('tictactoe', ps);
  assert.ok(d.C < 0, 'the penalised leaver loses rating');
  assert.ok(d.C < d.B, 'worse than the other loser');
  close(sum(d), 0, 'still zero-sum with a leaver');
}

// a leave without a penalty is not rated for that person, and the match still counts for the rest
{
  const parts = [
    { playerId: 'A', isWinner: true },
    { playerId: 'B', isWinner: false },
    { playerId: 'C', leftEarly: true, forfeit: false },
  ];
  const e = r.eligibility(parts, { finished: true });
  assert.equal(e.rated, true);
  assert.deepEqual(e.players.map((p) => p.playerId), ['A', 'B']);
}

// unrated matches: bots, guests, unfinished, too few players
assert.equal(r.eligibility([{ playerId: 'A', isWinner: true }, { playerId: 'bot', isBot: true }]).reason, 'bot');
assert.equal(r.eligibility([{ playerId: 'A', isWinner: true }, { playerId: 'G', isGuest: true }]).reason, 'guest');
assert.equal(r.eligibility([{ playerId: 'A' }, { playerId: 'B' }], { finished: false }).reason, 'unfinished');
assert.equal(r.eligibility([{ playerId: 'A', isWinner: true }, { playerId: 'B', leftEarly: true, forfeit: false }]).reason, 'too-few-players');
assert.equal(r.eligibility([{ playerId: 'A' }, { playerId: 'B' }]).rated, true, 'two humans is rated');

// pair limit: first 3 in full, 4 and 5 at half, then nothing
assert.equal(r.pairMultiplier(0), 1);
assert.equal(r.pairMultiplier(2), 1);
assert.equal(r.pairMultiplier(3), 0.5);
assert.equal(r.pairMultiplier(4), 0.5);
assert.equal(r.pairMultiplier(5), 0);

// daily cap: a rating in one game moves at most DAILY_CAP per UTC day
assert.equal(r.cappedDelta(0, 20), 20);
assert.equal(r.cappedDelta(50, 20), 10, 'only up to the cap');
assert.equal(r.cappedDelta(r.DAILY_CAP, 20), 0, 'nothing more once capped');
assert.equal(r.cappedDelta(-50, -20), -10, 'the same cap downwards');
assert.equal(r.cappedDelta(-r.DAILY_CAP, -5), 0);

// monthly scope is the UTC calendar month
assert.equal(r.monthKey(new Date('2026-11-30T23:59:59Z')), '2026-11');
assert.equal(r.monthKey(new Date('2026-12-01T00:00:00Z')), '2026-12');
assert.equal(r.monthKey(new Date('2026-01-05T12:00:00Z')), '2026-01');

// mixed experience stays zero-sum: a newcomer's win costs a veteran exactly what it gives the newcomer
{
  const newcomerWin = r.matchDeltas('chess', [pl('N', 1000, 1, { ratedGames: 0 }), pl('V', 1000, 0, { ratedGames: 50 })]);
  close(newcomerWin.N, -newcomerWin.V, 'newcomer vs veteran is symmetric');
  close(sum(newcomerWin), 0, 'mixed-experience 1v1 is zero-sum');
  const mixed = r.matchDeltas('wizard', [
    pl('A', 1100, -1, { ratedGames: 2 }),
    pl('B', 950, -2, { ratedGames: 40 }),
    pl('C', 1000, -3, { ratedGames: 12 }),
    pl('D', 1300, -4, { ratedGames: 0 }),
  ]);
  close(sum(mixed), 0, 'mixed-experience placing match is zero-sum');
  const mixedTeams = r.matchDeltas('twentynine', [
    pl('A1', 1000, 1, { teamId: 'X', ratedGames: 0 }),
    pl('A2', 1000, 1, { teamId: 'X', ratedGames: 60 }),
    pl('B1', 1000, 0, { teamId: 'Y', ratedGames: 3 }),
    pl('B2', 1000, 0, { teamId: 'Y', ratedGames: 9 }),
  ]);
  close(sum(mixedTeams), 0, 'mixed-experience team match is zero-sum (equal teams)');
}

// team value is the lowest member's value, so the member order does not matter
{
  const one = r.matchDeltas('twentynine', [
    pl('A1', 1000, 1, { teamId: 'X' }),
    pl('A2', 1000, -Infinity, { teamId: 'X' }), // penalised leaver
    pl('B1', 1000, 1, { teamId: 'Y' }),
    pl('B2', 1000, 1, { teamId: 'Y' }),
  ]);
  const swapped = r.matchDeltas('twentynine', [
    pl('A2', 1000, -Infinity, { teamId: 'X' }),
    pl('A1', 1000, 1, { teamId: 'X' }),
    pl('B2', 1000, 1, { teamId: 'Y' }),
    pl('B1', 1000, 1, { teamId: 'Y' }),
  ]);
  close(one.A1, swapped.A1, 'team change does not depend on member order');
  assert.ok(one.A1 < 0, 'a team with a penalised leaver loses');
  assert.ok(Number.isFinite(one.A1) && Number.isFinite(one.B1), 'no infinite changes');
}

// unequal teams (a 2v2 where one winner left without a penalty): the total still balances to zero
{
  const ps = [
    pl('A1', 1000, 1, { teamId: 'X' }),
    pl('B1', 1000, 0, { teamId: 'Y' }),
    pl('B2', 1000, 0, { teamId: 'Y' }),
  ];
  const d = r.matchDeltas('twentynine', ps);
  close(sum(d), 0, 'unequal teams are zero-sum');
  assert.ok(d.A1 > 0 && d.B1 < 0, 'the winner gains and the losing team loses');
}

// cooperative: everyone gets the same change, and a penalised leaver is a loss for the table, with no infinity
{
  const cleared = r.matchDeltas('themind', [pl('A', 1000, 1, { ratedGames: 0 }), pl('B', 1400, 1, { ratedGames: 30 })]);
  close(cleared.A, cleared.B, 'the same change for everyone at the table');
  assert.ok(cleared.A > 0);
  const forfeit = r.matchDeltas('themind', [pl('A', 1000, 1), pl('B', 1000, -Infinity, { forfeit: true })]);
  close(forfeit.A, forfeit.B, 'a forfeit loses the table for everyone');
  assert.ok(forfeit.A < 0 && Number.isFinite(forfeit.A), 'a finite loss');
}

// unknown games fall back to the placing family at full weight, like lib/gameSkill.js
assert.deepEqual(r.gameRule('some-new-game'), { family: 'pairwise', weight: 1 });
// an id that is an Object.prototype property is not a game: it gets the default rule, not a prototype value
assert.deepEqual(r.gameRule('constructor'), { family: 'pairwise', weight: 1 });
assert.deepEqual(r.gameRule('toString'), { family: 'pairwise', weight: 1 });

console.log('ratings: all tests passed');
