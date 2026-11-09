'use strict';
// Voice on the page (public/voice.js), without a browser: a fake RTCPeerConnection checks the ICE restart rules.
//  - a relayed (TURN) call is restarted when fresh logins arrive, so it moves to the new allocation;
//  - a direct call is not restarted (nothing to fix, nothing interrupted);
//  - only the person with the smaller id sends the restart offer (no glare);
//  - the answering side renegotiates the same connection and does not tear the call down.
require('./helpers/env');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

Object.defineProperty(globalThis, 'window', { value: { isSecureContext: true }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
// the module assigns window.TVVoice; the file itself is the code that ships to browsers
require(path.join(__dirname, '..', 'public', 'voice.js'));

/** A connection that records what the voice code does with it. `relay` decides the selected path's candidate type. */
class FakePC {
  constructor(cfg) {
    this.cfg = cfg;
    this.connectionState = 'new';
    this.signalingState = 'stable';
    this.localDescription = null;
    this.remoteDescription = null;
    this.relay = false;
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
      { id: 'P1', type: 'candidate-pair', selected: true, localCandidateId: 'L1', state: 'succeeded' },
    ];
    return { forEach: (fn) => rows.forEach(fn) };
  }
  close() { this.connectionState = 'closed'; }
}
FakePC.all = [];
FakePC.configured = [];

const media = { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) };
const LOGINS = [{ urls: 'turn:x:3478', username: 'fresh', credential: 'c' }];

/** A voice instance for `myId` at a table with `others`, already joined (no microphone), with an outbox. */
function setup(myId, others) {
  const sent = [];
  const voice = window.TVVoice({
    send: (m) => sent.push(m), getIce: () => LOGINS, myId: () => myId, onChange: () => {}, rtc: FakePC, media, audioRoot: null,
  });
  return { voice, sent };
}
const restartOffers = (sent) => sent.filter((m) => m.t === 'rtc' && m.data && m.data.kind === 'offer' && m.data.restart);
const settle = () => new Promise((r) => setImmediate(r));

(async () => {
  console.log('voice on the page: ICE restart');

  await test('a relayed call is restarted when fresh logins arrive, and the new login is applied', async () => {
    FakePC.all.length = 0; FakePC.configured.length = 0;
    const { voice, sent } = setup('a', ['b']);
    await voice.join(false);
    voice.updateList([{ id: 'a', muted: true }, { id: 'b', muted: true }]);
    await settle();
    const pc = FakePC.all[0];
    assert.ok(pc, 'an offer was made to b');
    await voice.handleRtc('b', { kind: 'answer', sdp: 'their-answer' }); // the call is set up: stable signalling
    pc.connectionState = 'connected';
    pc.relay = true;
    await voice.refreshIce();
    assert.deepEqual(FakePC.configured.at(-1), LOGINS, 'the new login is set on the connection');
    const r = restartOffers(sent);
    assert.equal(r.length, 1, 'one restart offer');
    assert.equal(r[0].to, 'b');
    assert.equal(r[0].data.sdp, 'offer-restart');
  });

  await test('a direct call keeps running: logins are applied, but no restart is sent', async () => {
    FakePC.all.length = 0; FakePC.configured.length = 0;
    const { voice, sent } = setup('a', ['b']);
    await voice.join(false);
    voice.updateList([{ id: 'a', muted: true }, { id: 'b', muted: true }]);
    await settle();
    const pc = FakePC.all[0];
    await voice.handleRtc('b', { kind: 'answer', sdp: 'their-answer' });
    pc.connectionState = 'connected';
    pc.relay = false;
    await voice.refreshIce();
    assert.deepEqual(FakePC.configured.at(-1), LOGINS);
    assert.equal(restartOffers(sent).length, 0, 'no interruption for a direct call');
  });

  await test('only the person with the smaller id restarts (no glare)', async () => {
    FakePC.all.length = 0;
    const { voice, sent } = setup('b', ['a']);
    await voice.join(false);
    voice.updateList([{ id: 'a', muted: true }, { id: 'b', muted: true }]);
    await settle();
    // b answers a's call instead of making one: create the connection the way an incoming offer does
    await voice.handleRtc('a', { kind: 'offer', sdp: 'remote-offer' });
    const pc = FakePC.all[0];
    pc.connectionState = 'connected';
    pc.relay = true;
    await voice.refreshIce();
    assert.equal(restartOffers(sent).length, 0, 'the larger id never sends the restart offer');
  });

  await test('the answering side renegotiates in place: the same connection stays and an answer is sent', async () => {
    FakePC.all.length = 0;
    const { voice, sent } = setup('b', ['a']);
    await voice.join(false);
    voice.updateList([{ id: 'a', muted: true }, { id: 'b', muted: true }]);
    await voice.handleRtc('a', { kind: 'offer', sdp: 'first-offer' });
    const before = FakePC.all.length;
    const pc = FakePC.all[0];
    pc.connectionState = 'connected';
    await voice.handleRtc('a', { kind: 'offer', sdp: 'restart-offer', restart: true });
    assert.equal(FakePC.all.length, before, 'no new connection: the call is kept');
    assert.equal(pc.remoteDescription.sdp, 'restart-offer');
    const answers = sent.filter((m) => m.t === 'rtc' && m.data && m.data.kind === 'answer');
    assert.ok(answers.length >= 2, 'an answer goes back for the restart as well');
  });

  console.log(`\n${passed} voice-client tests passed`);
  process.exit(process.exitCode || 0); // the meter timer would keep the process alive
})();
