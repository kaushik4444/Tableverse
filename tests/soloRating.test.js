'use strict';
// Solo rating: which matches take the solo path, the outcome of a game, and the change against the par rating. Pure.
const assert = require('node:assert/strict');
const S = require('../lib/soloRating');
const R = require('../lib/ratings');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

const solo = (over = {}, opts = { difficulty: 'easy' }) => ({
  id: 'm', gameId: 'sudoku', completed: true, options: opts,
  participants: [{ playerId: 'A', isBot: false, leftEarly: false, forfeit: false, isWinner: true, score: 120, ...over }],
});

test('only one-seat sudoku matches take the solo path', () => {
  assert.equal(S.appliesTo(solo()), true);
  assert.equal(S.appliesTo({ ...solo(), gameId: 'chess' }), false);
  assert.equal(S.appliesTo({ ...solo(), participants: [...solo().participants, { playerId: 'B' }] }), false);
});

test('a solve within par is 1, a slower solve is 0.5, a loss is 0 and gets its own scope', () => {
  assert.deepEqual(S.soloResult(solo()), { rated: true, playerId: 'A', scope: 'solo-easy', outcome: 1 });
  assert.equal(S.soloResult(solo({ score: S.PAR_SECONDS.easy + 1 })).outcome, 0.5);
  assert.equal(S.soloResult(solo({ isWinner: false, score: 0 })).outcome, 0);
  assert.equal(S.soloResult(solo({}, { difficulty: 'hard' })).scope, 'solo-hard');
});

test('a penalised leave is a loss; a plain leave is not rated; a bot or missing difficulty is not rated', () => {
  assert.equal(S.soloResult(solo({ leftEarly: true, forfeit: true, isWinner: true })).outcome, 0);
  assert.equal(S.soloResult(solo({ leftEarly: true, forfeit: false })).rated, false);
  assert.equal(S.soloResult(solo({ isBot: true })).reason, 'bot');
  assert.equal(S.soloResult(solo({}, {})).reason, 'solo-difficulty');
  assert.equal(S.soloResult({ ...solo(), completed: false }).reason, 'unfinished');
});

test('a win moves the rating up, a loss moves it down, and a par-rated start is the middle', () => {
  assert.ok(Math.abs(S.soloDelta(R.START, 0.5)) < 1e-9, 'starting at par, a half result moves nothing');
  assert.ok(S.soloDelta(R.START, 1) > 0);
  assert.ok(S.soloDelta(R.START, 0) < 0);
  assert.ok(S.soloDelta(1400, 1) < S.soloDelta(R.START, 1), 'a stronger player gains less for the same solve');
});

console.log(`\n${passed} solo rating tests passed`);

// a guest seat (an anonymous account) is not rated, even though it has a stored player id
{
  const SR = require('../lib/soloRating');
  const difficulty = Object.keys(SR.PAR_SECONDS)[0];
  const base = { completed: true, options: { difficulty }, participants: [{ playerId: 'guest-uuid', isBot: false, isWinner: true, score: 1, isGuest: true }] };
  const r = SR.soloResult(base);
  if (r.rated !== false || r.reason !== 'guest') throw new Error('a guest solo win must not be rated: ' + JSON.stringify(r));
  const reg = { ...base, participants: [{ ...base.participants[0], isGuest: false }] };
  if (SR.soloResult(reg).rated !== true) throw new Error('a registered solo win is still rated');
  console.log('  ok  a guest solo win is not rated');
}
