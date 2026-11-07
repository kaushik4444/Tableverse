'use strict';
// Chat moderation rules that need no database: report validation, block targets and the visibility filter.
const assert = require('node:assert/strict');
const m = require('../lib/moderation');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const MID = '3f2c1a9e-7b4d-4e8a-9c1f-0a1b2c3d4e5f';
const SELF = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

console.log('chat moderation rules');

test('a report needs a server-issued message id and a known reason', () => {
  assert.equal(m.validateReport({ messageId: MID, reason: 'spam' }).ok, true);
  assert.equal(m.validateReport({ messageId: 'not-a-uuid', reason: 'spam' }).ok, false);
  assert.equal(m.validateReport({ messageId: undefined, reason: 'spam' }).ok, false);
  assert.equal(m.validateReport({ messageId: MID, reason: 'because' }).ok, false, 'unknown reason refused');
  assert.equal(m.validateReport({ messageId: MID }).ok, false, 'missing reason refused');
  assert.equal(m.validateReport(null).ok, false);
});

test('report details are cleaned and capped, and non-text details become empty', () => {
  const r = m.validateReport({ messageId: MID, reason: 'other', details: 'a\u0000b\n\tc' + 'x'.repeat(500) });
  assert.equal(r.ok, true);
  assert.equal(r.details.length, m.MAX_DETAILS);
  assert.equal(r.details.slice(0, 5), 'a b c', 'control characters become spaces');
  assert.equal(m.validateReport({ messageId: MID, reason: 'other', details: { evil: true } }).details, '');
  assert.equal(m.validateReport({ messageId: MID, reason: 'other' }).details, '');
});

test('the report carries only the id, reason and details, never client text or an author', () => {
  const r = m.validateReport({ messageId: MID, reason: 'hate', details: 'x', text: 'forged', id: OTHER, name: 'Fake' });
  assert.deepEqual(Object.keys(r).sort(), ['details', 'messageId', 'ok', 'reason']);
});

test('a block target must be an account id and not the blocker', () => {
  assert.equal(m.validateBlockTarget(SELF, OTHER).ok, true);
  assert.equal(m.validateBlockTarget(SELF, SELF).ok, false, 'cannot block yourself');
  assert.equal(m.validateBlockTarget(SELF, 'bob').ok, false, 'a username or junk is not an account id');
  assert.equal(m.validateBlockTarget(SELF, undefined).ok, false);
});

test('a viewer never sees chat from an author they blocked, and system lines always show', () => {
  const blocked = new Set([OTHER]);
  const chat = [
    { id: OTHER, text: 'hi', name: 'Other' },
    { id: SELF, text: 'mine', name: 'Me' },
    { sys: true, text: 'Round started' },
  ];
  const seen = m.visibleChat(chat, blocked);
  assert.deepEqual(seen.map((x) => x.text), ['mine', 'Round started']);
  assert.equal(m.shouldDeliver({ id: OTHER, text: 'hi' }, blocked), false);
  assert.equal(m.shouldDeliver({ id: OTHER, text: 'hi' }, new Set()), true, 'nothing blocked: everything shows');
});

test('the filter tolerates missing lists and missing block sets', () => {
  assert.deepEqual(m.visibleChat(undefined, new Set()), []);
  assert.deepEqual(m.visibleChat([{ id: OTHER, text: 'x' }], undefined).length, 1);
});

test('limits are the documented values', () => {
  assert.equal(m.MAX_DETAILS, 300);
  assert.equal(m.MAX_REPORTS_PER_DAY, 20);
  assert.equal(m.MAX_BLOCKS, 500);
  assert.equal(m.UNBLOCK_COOLDOWN_MS, 1000);
  assert.deepEqual([...m.REPORT_REASONS], ['harassment', 'hate', 'threats', 'sexual', 'spam', 'other']);
});

console.log(`${passed} chat moderation checks passed`);
