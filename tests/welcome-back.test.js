'use strict';
// The welcome-back rules: the streak of days with a finished game, and when a return earns a welcome at all.
const assert = require('node:assert/strict');
const { streakDays, summarize } = require('../lib/welcomeBack');

const NOW = new Date('2026-11-22T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

function test(name, fn) {
  try { fn(); console.log('ok -', name); } catch (e) { console.error('FAIL -', name); throw e; }
}

test('a streak counts consecutive days ending today', () => {
  assert.equal(streakDays(['2026-11-22', '2026-11-21', '2026-11-20'], NOW), 3);
});

test('a streak still counts when nothing was played yet today', () => {
  assert.equal(streakDays(['2026-11-21', '2026-11-20'], NOW), 2);
});

test('a gap ends the streak', () => {
  assert.equal(streakDays(['2026-11-22', '2026-11-20', '2026-11-19'], NOW), 1);
});

test('no recent games is a streak of zero', () => {
  assert.equal(streakDays(['2026-11-10'], NOW), 0);
  assert.equal(streakDays([], NOW), 0);
});

test('a new player (no previous visit) gets no welcome', () => {
  assert.equal(summarize({ previousSeenAt: null, dayKeys: [], now: NOW }), null);
});

test('a return within the same day gets no welcome', () => {
  assert.equal(summarize({ previousSeenAt: ago(0.5), dayKeys: [], now: NOW }), null);
});

test('a return after days away reports the days, the streak, and the previous visit', () => {
  const s = summarize({ previousSeenAt: ago(3), dayKeys: ['2026-11-22', '2026-11-21'], now: NOW });
  assert.deepEqual(s, { awayDays: 3, streak: 2, since: ago(3) });
});

test('days away end at the return, so a player who stays active is not counted as away longer', () => {
  // left 4 days ago, came back 2.4 hours ago: 3 full days away, not 4 measured to now
  const s = summarize({ previousSeenAt: ago(4), visitStartedAt: ago(0.1), dayKeys: [], now: NOW });
  assert.equal(s.awayDays, 3);
});

console.log('welcome-back tests passed');
