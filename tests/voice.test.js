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

test('a viewer is not offered a voice partner they are blocked with; the viewer is always listed to self', () => {
  const r = room();
  for (const id of ['p0', 'p1', 'p2']) V.setVoice(r, id, true);
  const blockedPairs = new Set(['p0|p1', 'p1|p0']); // p0 and p1 block each other (either direction hides both ways)
  const hiddenFor = (viewer) => (id) => blockedPairs.has(viewer + '|' + id);
  assert.deepEqual(V.voiceList(r, hiddenFor('p0'), 'p0').map((v) => v.id).sort(), ['p0', 'p2'], 'p0 does not see p1');
  assert.deepEqual(V.voiceList(r, hiddenFor('p1'), 'p1').map((v) => v.id).sort(), ['p1', 'p2'], 'p1 does not see p0');
  assert.deepEqual(V.voiceList(r, hiddenFor('p2'), 'p2').map((v) => v.id).sort(), ['p0', 'p1', 'p2'], 'p2 sees everyone');
  assert.deepEqual(V.voiceList(r).map((v) => v.id).sort(), ['p0', 'p1', 'p2'], 'with no filter the list is the whole table');
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

test('a kicked or departed player is refused even if an old voice entry is still there', () => {
  // the voice map still lists p2, but p2 is no longer a seated member (for example, removed by the host)
  const r = room(3);
  r.members = r.members.filter((m) => m.id !== 'p2');
  V.setVoice(r, 'p0', true);
  V.setVoice(r, 'p1', true);
  r.voice.set('p2', { muted: false });
  const sent = [];
  const deliver = (to, m) => sent.push([to, m]);
  assert.equal(V.relay(r, 'p2', 'p0', { kind: 'offer', sdp: 'v=0' }, deliver).ok, false, 'a removed sender is refused');
  assert.equal(V.relay(r, 'p0', 'p2', { kind: 'offer', sdp: 'v=0' }, deliver).ok, false, 'a removed recipient is refused');
  assert.equal(V.relay(r, 'p0', 'p1', { kind: 'offer', sdp: 'v=0' }, deliver).ok, true, 'two seated players still connect');
  assert.equal(sent.length, 1, 'nothing was delivered to the removed player');
  assert.equal(V.isSeatedHuman(r, 'bot'), false, 'bots are not voice members');
});

test('dropping a player frees their slot, and the list no longer offers them', () => {
  const r = room(3);
  V.setVoice(r, 'p0', true);
  V.setVoice(r, 'p1', true);
  assert.equal(V.dropVoice(r, 'p1'), true, 'the list changed');
  assert.equal(V.dropVoice(r, 'p1'), false, 'dropping again changes nothing');
  assert.deepEqual(V.voiceList(r).map((v) => v.id), ['p0']);
});

test('with a shared secret, TURN gets a short-lived login per player and no static credential is sent', () => {
  const crypto = require('node:crypto');
  const env = { TURN_URL: 'turn:t.example:3478', TURN_SHARED_SECRET: 'top-secret', TURN_USERNAME: 'static-user', TURN_CREDENTIAL: 'static-pass' };
  const now = 1_700_000_000_000;
  const a = V.iceServers(env, { playerId: 'player-a', now });
  const b = V.iceServers(env, { playerId: 'player-b', now });
  const turnA = a.at(-1);
  assert.equal(turnA.urls, 'turn:t.example:3478');
  assert.equal(turnA.username, `${1_700_000_000 + 3600}:player-a`, 'expiry is one hour ahead, bound to the player');
  const expected = crypto.createHmac('sha1', 'top-secret').update(turnA.username).digest('base64');
  assert.equal(turnA.credential, expected, 'the credential is the HMAC the TURN server can verify');
  assert.notEqual(b.at(-1).username, turnA.username, 'each player gets their own login');
  const wire = JSON.stringify([a, b]);
  assert.ok(!wire.includes('static-pass') && !wire.includes('static-user') && !wire.includes('top-secret'), 'no static credential and no secret is sent');
});

test('a player-less TURN request is refused rather than handing out a static login', () => {
  const list = V.iceServers({ TURN_URL: 'turn:t.example:3478', TURN_SHARED_SECRET: 's', TURN_CREDENTIAL: 'static-pass' });
  assert.deepEqual(list, [{ urls: V.DEFAULT_STUN }], 'STUN only: TURN needs a player to be named');
});

test('the TURN login lifetime is clamped to 5 minutes .. 24 hours', () => {
  const now = 1_700_000_000_000;
  assert.equal(V.turnRestCredential('s', 'p', { now, ttlSeconds: 10 }).expiresAt, 1_700_000_000 + 300);
  assert.equal(V.turnRestCredential('s', 'p', { now, ttlSeconds: 10_000_000 }).expiresAt, 1_700_000_000 + 86400);
  assert.equal(V.turnRestCredential('s', 'p', { now, ttlSeconds: 'nonsense' }).expiresAt, 1_700_000_000 + 3600);
});

console.log(`\n${passed} voice tests passed`);
