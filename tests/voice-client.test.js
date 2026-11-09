'use strict';
// Voice on the page (public/voice.js), without a browser: a fake RTCPeerConnection checks the ICE restart rules.
//  - a relayed call (TURN on either side of the selected path) is restarted when the logins change;
//  - a direct call is not restarted, and unchanged logins change nothing at all;
//  - only the person with the smaller id sends the restart offer (no glare), and restarts never overlap;
//  - the answering side renegotiates the same connection and does not tear the call down;
//  - the server keeps the restart flag through its signal sanitiser.
require('./helpers/env');
const assert = require('node:assert/strict');
const path = require('node:path');
const V = require('../lib/voiceRelay');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

Object.defineProperty(globalThis, 'window', { value: { isSecureContext: true }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
require(path.join(__dirname, '..', 'public', 'voice.js')); // assigns window.TVVoice: the same file that ships to browsers

/** A connection that records what the voice code does with it. `relay` / `remoteRelay` set the candidate types of the selected pair. */
class FakePC {
  constructor(cfg) {
    this.cfg = cfg;
    this.connectionState = 'new';
    this.signalingState = 'stable';
    this.localDescription = null;
    this.remoteDescription = null;
    this.relay = false;
    this.remoteRelay = false;
    FakePC.all.push(this);
  }
  addTransceiver() { return { sender: { replaceTrack: async () => {} }, receiver: { track: { kind: 'audio' } }, direction: 'sendrecv' }; }
  getTransceivers() { return []; }
  getConfiguration() { return this.cfg; }
  setConfiguration(c) { this.cfg = c; FakePC.configured.push(c.iceServers); }
  async createOffer(opts = {}) { return { type: 'offer', sdp: 'offer' + (opts.iceRestart ? '-restart' : '') }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
  async setLocalDescription(d) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(d) { this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  async addIceCandidate() {}
  async getStats() {
    const rows = [
      { id: 'L1', type: 'local-candidate', candidateType: this.relay ? 'relay' : 'host' },
      { id: 'R1', type: 'remote-candidate', candidateType: this.remoteRelay ? 'relay' : 'host' },
      { id: 'P1', type: 'candidate-pair', selected: true, localCandidateId: 'L1', remoteCandidateId: 'R1', state: 'succeeded' },
    ];
    return { forEach: (fn) => rows.forEach(fn) };
  }
  close() { this.connectionState = 'closed'; }
}
FakePC.all = [];
FakePC.configured = [];

const media = { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) };
const FIRST = [{ urls: 'turn:x:3478', username: 'first', credential: 'c1' }];
const FRESH = [{ urls: 'turn:x:3478', username: 'fresh', credential: 'c2' }];

/** A joined voice instance for `myId`. `ice.list` is what the server would hand out now. */
function setup(myId) {
  const sent = [];
  const ice = { list: FIRST };
  const voice = window.TVVoice({
    send: (m) => sent.push(m), getIce: () => ice.list, myId: () => myId, onChange: () => {}, rtc: FakePC, media, audioRoot: null,
  });
  return { voice, sent, ice };
}
const restartOffers = (sent) => sent.filter((m) => m.t === 'rtc' && m.data && m.data.kind === 'offer' && m.data.restart);
const settle = () => new Promise((r) => setImmediate(r));
/** Sets up a call from `myId` to `other` (myId is the smaller id, so it makes the offer) and returns its connection. */
async function callUp({ myId, other = 'b', relay = false, remoteRelay = false }) {
  const env = setup(myId);
  await env.voice.join(false);
  env.voice.updateList([{ id: myId, muted: true }, { id: other, muted: true }]);
  await settle();
  const pc = FakePC.all.find((p) => p.localDescription);
  await env.voice.handleRtc(other, { kind: 'answer', sdp: 'their-answer' }); // signalling is now stable
  pc.connectionState = 'connected';
  pc.relay = relay;
  pc.remoteRelay = remoteRelay;
  return { ...env, pc };
}

(async () => {
  console.log('voice on the page: ICE restart');

  await test('a relayed call is restarted when the logins change, and the new login is applied', async () => {
    FakePC.all.length = 0; FakePC.configured.length = 0;
    const c = await callUp({ myId: 'a', relay: true });
    c.ice.list = FRESH;
    c.voice.refreshIce();
    await settle(); await settle();
    assert.deepEqual(FakePC.configured.at(-1), FRESH, 'the new login is set on the connection');
    const r = restartOffers(c.sent);
    assert.equal(r.length, 1, 'one restart offer');
    assert.equal(r[0].to, 'b');
    assert.equal(r[0].data.sdp, 'offer-restart');
  });

  await test('a call relayed only on the other side is restarted too (the smaller id sends it)', async () => {
    FakePC.all.length = 0;
    const c = await callUp({ myId: 'a', relay: false, remoteRelay: true });
    c.ice.list = FRESH;
    c.voice.refreshIce();
    await settle(); await settle();
    assert.equal(restartOffers(c.sent).length, 1);
  });

  await test('a direct call keeps running: logins are applied, but no restart is sent', async () => {
    FakePC.all.length = 0; FakePC.configured.length = 0;
    const c = await callUp({ myId: 'a', relay: false, remoteRelay: false });
    c.ice.list = FRESH;
    c.voice.refreshIce();
    await settle(); await settle();
    assert.deepEqual(FakePC.configured.at(-1), FRESH);
    assert.equal(restartOffers(c.sent).length, 0, 'no interruption for a direct call');
  });

  await test('unchanged logins change nothing: no configuration update and no restart, however often they are offered', async () => {
    FakePC.all.length = 0; FakePC.configured.length = 0;
    const c = await callUp({ myId: 'a', relay: true });
    const before = FakePC.configured.length;
    for (let i = 0; i < 5; i++) c.voice.refreshIce(); // the browser asks every ~20 s while a replacement propagates
    await settle(); await settle();
    assert.equal(FakePC.configured.length, before, 'no configuration churn');
    assert.equal(restartOffers(c.sent).length, 0, 'no renegotiation for the same login');
  });

  await test('updates that arrive before a restart starts are covered by one restart with the newest logins', async () => {
    FakePC.all.length = 0;
    const c = await callUp({ myId: 'a', relay: true });
    c.ice.list = FRESH; c.voice.refreshIce();
    c.ice.list = [{ urls: 'turn:x:3478', username: 'third', credential: 'c3' }]; c.voice.refreshIce();
    await settle(); await settle();
    assert.equal(restartOffers(c.sent).length, 1, 'one restart');
    assert.equal(c.pc.getConfiguration().iceServers[0].username, 'third', 'and it runs on the newest login');
    await c.voice.handleRtc('b', { kind: 'answer', sdp: 'restart-answer' });
    await settle(); await settle();
    assert.equal(restartOffers(c.sent).length, 1, 'nothing more to do');
  });

  await test('a login that arrives while a restart is in negotiation gets its own restart after the answer', async () => {
    FakePC.all.length = 0;
    const c = await callUp({ myId: 'a', relay: true });
    c.ice.list = FRESH; c.voice.refreshIce();
    await settle(); await settle();
    assert.equal(restartOffers(c.sent).length, 1, 'first restart is in negotiation');
    c.ice.list = [{ urls: 'turn:x:3478', username: 'third', credential: 'c3' }]; c.voice.refreshIce();
    await settle(); await settle();
    assert.equal(restartOffers(c.sent).length, 1, 'no competing offer while negotiating');
    await c.voice.handleRtc('b', { kind: 'answer', sdp: 'restart-answer' });
    await settle(); await settle();
    assert.equal(restartOffers(c.sent).length, 2, 'the newer login is applied by a second restart');
  });

  await test('only the person with the smaller id restarts (no glare)', async () => {
    FakePC.all.length = 0;
    const env = setup('b');
    await env.voice.join(false);
    env.voice.updateList([{ id: 'a', muted: true }, { id: 'b', muted: true }]);
    await env.voice.handleRtc('a', { kind: 'offer', sdp: 'remote-offer' });
    const pc = FakePC.all[0];
    pc.connectionState = 'connected';
    pc.relay = true;
    env.ice.list = FRESH; env.voice.refreshIce();
    await settle(); await settle();
    assert.equal(restartOffers(env.sent).length, 0, 'the larger id never sends the restart offer');
  });

  await test('the answering side renegotiates in place: the same connection stays and an answer is sent', async () => {
    FakePC.all.length = 0;
    const env = setup('b');
    await env.voice.join(false);
    env.voice.updateList([{ id: 'a', muted: true }, { id: 'b', muted: true }]);
    await env.voice.handleRtc('a', { kind: 'offer', sdp: 'first-offer' });
    const before = FakePC.all.length;
    const pc = FakePC.all[0];
    pc.connectionState = 'connected';
    await env.voice.handleRtc('a', { kind: 'offer', sdp: 'restart-offer', restart: true });
    assert.equal(FakePC.all.length, before, 'no new connection: the call is kept');
    assert.equal(pc.remoteDescription.sdp, 'restart-offer');
    const answers = env.sent.filter((m) => m.t === 'rtc' && m.data && m.data.kind === 'answer');
    assert.ok(answers.length >= 2, 'an answer goes back for the restart as well');
  });

  await test('the server keeps the restart flag through its signal sanitiser (and only for offers)', () => {
    const kept = V.cleanSignal({ kind: 'offer', sdp: 'x', restart: true });
    assert.deepEqual(kept, { kind: 'offer', sdp: 'x', restart: true });
    assert.deepEqual(V.cleanSignal({ kind: 'offer', sdp: 'x' }), { kind: 'offer', sdp: 'x' }, 'a normal offer has no flag');
    assert.deepEqual(V.cleanSignal({ kind: 'answer', sdp: 'x', restart: true }), { kind: 'answer', sdp: 'x' }, 'answers carry no flag');
  });

  console.log(`\n${passed} voice-client tests passed`);
  process.exit(process.exitCode || 0); // the meter timer would keep the process alive
})();
