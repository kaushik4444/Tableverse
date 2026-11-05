'use strict';
// Table voice: who may talk, the size cap, the relay of setup messages, and the ICE server configuration. No sockets needed.
const assert = require('node:assert/strict');
const V = require('../lib/voiceRelay');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
const room = (n = 3) => ({ members: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, bot: false })).concat([{ id: 'bot', bot: true }]), voice: undefined });

test('seated humans can join voice, leave it and change mute; bots and outsiders cannot', () => {
  const r = room();
  assert.deepEqual(V.setVoice(r, 'p0', true), { ok: true, changed: true });
  assert.deepEqual(V.setVoice(r, 'p0', true), { ok: true, changed: false }, 'joining twice changes nothing');
  assert.deepEqual(V.setVoice(r, 'p0', true, true), { ok: true, changed: true }, 'muting is a change');
  assert.deepEqual(V.voiceList(r), [{ id: 'p0', muted: true }]);
  assert.equal(V.setVoice(r, 'bot', true).ok, false);
  assert.equal(V.setVoice(r, 'stranger', true).ok, false);
  assert.deepEqual(V.setVoice(r, 'p0', false), { ok: true, changed: true });
  assert.deepEqual(V.voiceList(r), []);
});

test('the table is capped so the pairwise connections stay manageable', () => {
  const r = { members: Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, bot: false })) };
  for (let i = 0; i < V.MAX_VOICE; i++) assert.equal(V.setVoice(r, 'p' + i, true).ok, true);
  const full = V.setVoice(r, 'p9', true);
  assert.equal(full.ok, false);
  assert.match(full.error, /full/);
  assert.equal(V.setVoice(r, 'p0', true, true).ok, true, 'someone already in can still change mute');
});

test('dropping a person who left or disconnected reports whether anything changed', () => {
  const r = room();
  V.setVoice(r, 'p1', true);
  assert.equal(V.dropVoice(r, 'p1'), true);
  assert.equal(V.dropVoice(r, 'p1'), false);
  assert.equal(V.dropVoice({ members: [] }, 'x'), false, 'a table nobody ever spoke at');
});

test('setup messages go only between two people who are both in voice, and only well-formed ones', () => {
  const r = room();
  const got = [];
  const deliver = (to, m) => got.push([to, m]);
  V.setVoice(r, 'p0', true); V.setVoice(r, 'p1', true);
  assert.equal(V.relay(r, 'p0', 'p1', { kind: 'offer', sdp: 'v=0' }, deliver).ok, true);
  assert.deepEqual(got[0], ['p1', { t: 'rtc', from: 'p0', data: { kind: 'offer', sdp: 'v=0' } }], 'the receiver learns who it is from, taken from the server not the sender');
  assert.equal(V.relay(r, 'p0', 'p2', { kind: 'offer', sdp: 'v=0' }, deliver).ok, false, 'p2 is not in voice');
  assert.equal(V.relay(r, 'p2', 'p0', { kind: 'offer', sdp: 'v=0' }, deliver).ok, false, 'p2 is not in voice');
  assert.equal(V.relay(r, 'p0', 'p0', { kind: 'offer', sdp: 'v=0' }, deliver).ok, false, 'not to yourself');
  assert.equal(V.relay(r, 'p0', 'p1', { kind: 'hack', sdp: 'x' }, deliver).ok, false);
  assert.equal(V.relay(r, 'p0', 'p1', { kind: 'offer', sdp: 'x'.repeat(V.MAX_SIGNAL_BYTES + 1) }, deliver).ok, false);
  assert.equal(V.relay(r, 'p0', 'p1', null, deliver).ok, false);
  assert.equal(got.length, 1, 'nothing else was delivered');
});

test('ICE candidates are cleaned down to the fields browsers use', () => {
  assert.deepEqual(V.cleanSignal({ kind: 'ice', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0, extra: 'drop me' } }), { kind: 'ice', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.deepEqual(V.cleanSignal({ kind: 'ice', candidate: null }), { kind: 'ice', candidate: null });
  assert.equal(V.cleanSignal({ kind: 'ice', candidate: { candidate: 5 } }), null);
  assert.deepEqual(V.cleanSignal({ kind: 'answer', sdp: 'v=0', extra: 1 }), { kind: 'answer', sdp: 'v=0' });
});

test('ICE servers: STUN by default, TURN and custom lists from the environment', () => {
  assert.deepEqual(V.iceServers({}), [{ urls: V.DEFAULT_STUN }]);
  assert.deepEqual(V.iceServers({ STUN_URL: 'stun:mine:3478' }), [{ urls: 'stun:mine:3478' }]);
  assert.deepEqual(V.iceServers({ TURN_URL: 'turn:t.example:3478', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'c' }).at(-1), { urls: 'turn:t.example:3478', username: 'u', credential: 'c' });
  assert.deepEqual(V.iceServers({ ICE_SERVERS: '[{"urls":"stun:a"}]' }), [{ urls: 'stun:a' }]);
  assert.deepEqual(V.iceServers({ ICE_SERVERS: 'not json' }), [{ urls: V.DEFAULT_STUN }], 'a broken value falls back to the default');
});

console.log(`\n${passed} voice tests passed`);
