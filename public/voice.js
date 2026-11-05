/* Table voice chat. Everyone at a table can talk to everyone else: one direct WebRTC audio connection per pair of people
 * (the server only keeps the list of who is in voice and passes the small setup messages along; no audio goes through it).
 * Works for up to 8 people at a table. Two controls: the microphone (join and talk, then mute/unmute) and the speaker
 * (listen only, or silence everyone). Loaded before app.js; the page wires the buttons and shows who is talking.
 *
 *   const voice = TVVoice({ send, getIce, myId, onChange, rtc, media, audioRoot });
 *   voice.updateList([{ id, muted }])   a `voice` message from the server
 *   voice.handleRtc(from, data)         an `rtc` message from the server
 *   voice.toggleMic() / voice.toggleSpeaker() / voice.leave()
 *   voice.state                         { supported, joined, muted, deafened, error, list, speaking:Set }
 * `rtc` and `media` can be replaced in tests (RTCPeerConnection and navigator.mediaDevices).
 */
window.TVVoice = function TVVoice(o) {
  'use strict';
  const rtc = o.rtc || (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null);
  const media = o.media || (navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? navigator.mediaDevices : null);
  const state = { supported: !!(rtc && media && (window.isSecureContext !== false)), joined: false, muted: true, deafened: false, error: '', list: [], speaking: new Set(), blocked: false };
  const peers = new Map(); // id -> { pc, audio, pending: [], analyser, stream }
  const failures = new Map(); // id -> how many times in a row the audio link to that person failed
  const LINK_ERROR = 'Cannot connect audio to someone at this table. Their network may block direct audio (a TURN server is needed).';
  let local = null; // { stream, track }
  let ctx = null; // AudioContext for the "who is talking" rings
  let meter = null;
  const changed = () => { try { o.onChange && o.onChange(state); } catch { /* a UI error must not break the call */ } };
  const me = () => o.myId();

  // ---- who is talking: a level meter on every stream
  function audioCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { ctx = null; }
    return ctx;
  }
  function analyserFor(stream) {
    const c = audioCtx();
    if (!c || !stream) return null;
    try {
      const src = c.createMediaStreamSource(stream);
      const an = c.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      return { an, buf: new Uint8Array(an.fftSize), until: 0 };
    } catch { return null; }
  }
  function level(a) {
    a.an.getByteTimeDomainData(a.buf);
    let sum = 0;
    for (let i = 0; i < a.buf.length; i++) { const v = (a.buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / a.buf.length);
  }
  function startMeter() {
    if (meter) return;
    meter = setInterval(() => {
      const now = Date.now();
      const next = new Set();
      const check = (id, a, active) => {
        if (!a) return;
        if (active && level(a) > 0.035) a.until = now + 450; // hold the ring a moment so it does not flicker
        if (a.until > now) next.add(id);
      };
      if (state.joined && local) check(me(), local.analyser, !state.muted);
      for (const [id, p] of peers) check(id, p.analyser, !state.deafened);
      const same = next.size === state.speaking.size && [...next].every((id) => state.speaking.has(id));
      if (!same) { state.speaking = next; changed(); }
    }, 140);
  }
  function stopMeter() { clearInterval(meter); meter = null; if (state.speaking.size) { state.speaking = new Set(); } }

  // ---- microphone
  async function acquireMic() {
    if (local) return true;
    if (!media) { state.error = 'This browser cannot use a microphone.'; return false; }
    try {
      const stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('no track');
      local = { stream, track, analyser: analyserFor(stream) };
      for (const p of peers.values()) { const s = p.pc.getSenders && p.pc.getSenders().find((x) => !x.track || x.track.kind === 'audio'); if (s) s.replaceTrack(track).catch(() => {}); }
      state.error = '';
      return true;
    } catch (e) {
      state.error = e && e.name === 'NotAllowedError' ? 'Microphone is blocked. Allow it in your browser to talk; you can still listen.' : 'No microphone found. You can still listen.';
      return false;
    }
  }
  function releaseMic() {
    if (!local) return;
    try { local.stream.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
    for (const p of peers.values()) { const s = p.pc.getSenders && p.pc.getSenders()[0]; if (s) s.replaceTrack(null).catch(() => {}); }
    local = null;
  }
  let lastAnnounce = 0;
  const announce = (force) => { const now = Date.now(); if (!force && now - lastAnnounce < 2000) return; lastAnnounce = now; o.send({ t: 'voice', on: true, muted: state.muted }); };

  // ---- one connection per other person
  const inList = (id) => state.list.some((v) => v.id === id);
  function closePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    peers.delete(id);
    try { clearTimeout(p.dropTimer); p.pc.onicecandidate = null; p.pc.ontrack = null; p.pc.onconnectionstatechange = null; p.pc.close(); } catch { /* already closed */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
  }
  function makePeer(id, answering) {
    const pc = new rtc({ iceServers: (o.getIce && o.getIce()) || [] });
    const p = { pc, audio: null, pending: [], analyser: null };
    peers.set(id, p);
    // the caller adds the audio line; the person answering gets theirs from the offer (see handleRtc)
    if (!answering) {
      const t = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (local) t.sender.replaceTrack(local.track).catch(() => {});
    }
    pc.onicecandidate = (e) => o.send({ t: 'rtc', to: id, data: { kind: 'ice', candidate: e.candidate ? (e.candidate.toJSON ? e.candidate.toJSON() : e.candidate) : null } });
    pc.ontrack = (e) => {
      const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      if (!p.audio) {
        const a = document.createElement('audio');
        a.autoplay = true; a.playsInline = true; a.dataset.voiceFrom = id;
        (o.audioRoot || document.body).appendChild(a);
        p.audio = a;
      }
      p.audio.srcObject = stream;
      p.audio.muted = state.deafened;
      p.audio.volume = 1;
      stream.onaddtrack = () => { if (p.audio && p.audio.paused) p.audio.play().catch(() => {}); };
      p.analyser = analyserFor(stream);
      const play = p.audio.play && p.audio.play();
      if (play && play.catch) play.catch(() => { state.blocked = true; state.error = 'Tap anywhere on the screen to hear the other players.'; changed(); }); // the browser wants a tap first
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (peers.get(id) !== p) return;
      clearTimeout(p.dropTimer);
      if (s === 'connected') {
        failures.delete(id);
        if (state.error === LINK_ERROR) { state.error = ''; changed(); }
      } else if (s === 'disconnected') {
        // usually a short network blip that heals by itself; if it does not, start over with this person
        p.dropTimer = setTimeout(() => { if (peers.get(id) === p && pc.connectionState !== 'connected') { closePeer(id); reconcile(); } }, 5000);
      } else if (s === 'failed' || s === 'closed') {
        const n = (failures.get(id) || 0) + 1;
        failures.set(id, n);
        closePeer(id);
        if (n >= 2 && state.error !== LINK_ERROR) { state.error = LINK_ERROR; changed(); } // tell the user instead of failing silently
        setTimeout(reconcile, Math.min(1500 * n, 6000));
      }
    };
    return p;
  }
  async function offerTo(id) {
    const p = peers.get(id) || makePeer(id);
    try {
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      o.send({ t: 'rtc', to: id, data: { kind: 'offer', sdp: p.pc.localDescription.sdp } });
    } catch { closePeer(id); }
  }
  /** Make the set of connections match the list: close those who left, call the ones we should call. The person with the
   *  smaller id always makes the offer, so two people never call each other at the same moment. */
  function reconcile() {
    if (!state.joined) return;
    const mine = me();
    if (!inList(mine)) announce(); // the server forgot us (we reconnected): say we are here again
    for (const id of [...peers.keys()]) if (!inList(id)) closePeer(id);
    for (const v of state.list) {
      if (v.id === mine || peers.has(v.id)) continue;
      if (mine < v.id) offerTo(v.id);
    }
  }

  async function handleRtc(from, data) {
    if (!state.joined || !data) return;
    if (data.kind === 'offer') {
      closePeer(from); // a fresh offer starts a fresh connection
      const p = makePeer(from, true);
      try {
        await p.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const t = p.pc.getTransceivers().find((x) => x.receiver && x.receiver.track && x.receiver.track.kind === 'audio');
        if (t) { t.direction = 'sendrecv'; if (local) await t.sender.replaceTrack(local.track).catch(() => {}); } // talk back on the same line
        const answer = await p.pc.createAnswer();
        await p.pc.setLocalDescription(answer);
        o.send({ t: 'rtc', to: from, data: { kind: 'answer', sdp: p.pc.localDescription.sdp } });
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      } catch { closePeer(from); }
      return;
    }
    const p = peers.get(from);
    if (!p) return;
    try {
      if (data.kind === 'answer') {
        await p.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      } else if (data.kind === 'ice') {
        if (!data.candidate) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate).catch(() => {});
        else p.pending.push(data.candidate);
      }
    } catch { /* a stale message from a closed connection */ }
  }

  // ---- controls
  async function join(withMic) {
    if (!state.supported) { state.error = 'Voice chat needs a secure connection (https) and a modern browser.'; changed(); return; }
    state.joined = true;
    state.muted = true;
    if (audioCtx() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (withMic && await acquireMic()) state.muted = false;
    announce(true);
    startMeter();
    reconcile();
    changed();
  }
  async function toggleMic() {
    if (!state.joined) return join(true);
    if (state.muted) {
      if (!(await acquireMic())) { changed(); return; }
      state.muted = false;
    } else state.muted = true;
    if (local) local.track.enabled = !state.muted;
    announce(true);
    changed();
  }
  function toggleSpeaker() {
    if (!state.joined) return join(false); // listen without a microphone, no permission needed
    state.deafened = !state.deafened;
    for (const p of peers.values()) if (p.audio) p.audio.muted = state.deafened;
    changed();
  }
  function leave() {
    const was = state.joined;
    for (const id of [...peers.keys()]) closePeer(id);
    releaseMic();
    stopMeter();
    failures.clear();
    state.joined = false; state.muted = true; state.deafened = false; state.error = '';
    if (was) o.send({ t: 'voice', on: false });
    changed();
  }
  /** Reset without telling the server (we left the table or the connection dropped: the server already forgot us). */
  function reset() {
    for (const id of [...peers.keys()]) closePeer(id);
    releaseMic(); stopMeter(); failures.clear();
    state.joined = false; state.muted = true; state.deafened = false; state.error = ''; state.list = [];
    changed();
  }
  function updateList(list) {
    state.list = Array.isArray(list) ? list : [];
    reconcile();
    changed();
  }
  /** Browsers only start audio after a tap: call this from any click. */
  function resumeAudio() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Retry every paused element on each tap, not only after a rejected play(): some browsers (iOS) resolve play() and stay paused.
    for (const p of peers.values()) if (p.audio && p.audio.paused && p.audio.srcObject) p.audio.play().catch(() => {});
    if (state.blocked) { state.blocked = false; if (state.error.startsWith('Tap anywhere')) state.error = ''; changed(); }
  }

  return { state, join, toggleMic, toggleSpeaker, leave, reset, updateList, handleRtc, resumeAudio, _peers: peers };
};
