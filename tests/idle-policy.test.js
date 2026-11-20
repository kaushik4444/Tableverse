'use strict';
// A person a bot plays for three turns in a row is removed with a penalty; their own move starts the count again.
const assert = require('node:assert/strict');
const { IDLE_KICK_TURNS, noteBotTurn, clearIdle, kickIdle } = require('../lib/idlePolicy');

const room = (members) => ({ members, status: 'playing' });
const human = (id) => ({ id, name: id, bot: false });

(async () => {
  let passed = 0;
  const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

  t('three bot turns in a row remove the person; two do not', () => {
    assert.equal(IDLE_KICK_TURNS, 3);
    const r = room([human('a'), human('b')]);
    assert.equal(noteBotTurn(r, 'a'), false);
    assert.equal(noteBotTurn(r, 'a'), false);
    assert.equal(noteBotTurn(r, 'a'), true);
  });

  t('a move of their own starts the count again', () => {
    const r = room([human('a')]);
    noteBotTurn(r, 'a'); noteBotTurn(r, 'a');
    clearIdle(r, 'a');
    assert.equal(noteBotTurn(r, 'a'), false);
    assert.equal(noteBotTurn(r, 'a'), false);
  });

  t('the count is per person', () => {
    const r = room([human('a'), human('b')]);
    noteBotTurn(r, 'a'); noteBotTurn(r, 'a');
    assert.equal(noteBotTurn(r, 'b'), false);
  });

  t('a kick gives the seat to a bot, records a final penalty and blocks rejoining', () => {
    const a = human('a'); const b = human('b');
    const r = room([a, b]);
    r.leaveDeadlines = new Map();
    r.playTime = { open: new Map(), total: new Map() };
    r.playTime.open.set('a', 1000);
    const out = kickIdle(r, a, 5000);
    assert.equal(a.bot, true, 'a bot takes the seat');
    assert.equal(out.penalised, true, 'another person is still playing, so it counts as a loss');
    assert.ok(r.finalForfeits.has('a'), 'the penalty is final');
    assert.ok(r.forfeits.has('a'), 'the loss is recorded');
    assert.ok(r.leftEarly.has('a'));
    assert.ok(r.removed.has('a'), 'they cannot come back to this table');
    assert.ok(!(r.idleTurns && r.idleTurns.has('a')), 'the count is cleared');
  });

  t('a kick with no other person playing is not a loss', () => {
    const a = human('a');
    const r = room([a]);
    r.playTime = { open: new Map(), total: new Map() };
    const out = kickIdle(r, a, 5000);
    assert.equal(out.penalised, false);
  });

  console.log(`\n${passed} idle policy tests passed`);
})();
