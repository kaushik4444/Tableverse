'use strict';
const crypto = require('node:crypto');
/**
 * Table voice chat: the server never touches audio. Players talk to each other directly (WebRTC, one connection per
 * pair); the server only keeps the list of who is in voice at each table and relays the small setup messages
 * (offer, answer, ICE candidate) between two people at the same table. Pure functions, so they are tested without sockets.
 */
const MAX_VOICE = 8; // every pair is a direct connection, so the table size is capped
const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478']; // several, so one being blocked or down does not stop voice
const MAX_SIGNAL_BYTES = 12000; // an SDP offer for one audio line is about 1.5 KB; this leaves a wide margin
const KINDS = new Set(['offer', 'answer', 'ice']);

const voiceOf = (room) => room.voice || (room.voice = new Map());
/** True only for a current seated human at this table (not a bot, not a spectator, not someone the host removed). */
const isSeatedHuman = (room, id) => room.members.some((m) => m.id === id && !m.bot);

/** [{ id, muted }] for everyone in voice at this table. */
/**
 * Who is in voice, as one viewer should see it. `hidden(id)` leaves someone out (a blocked pair, see server.js): a hidden
 * person is not offered to the viewer, so the browser closes its connection to them and does not open one.
 */
function voiceList(room, hidden = () => false, viewerId = null) {
  return [...voiceOf(room)]
    .filter(([id]) => id === viewerId || !hidden(id))
    .map(([id, v]) => ({ id, muted: !!v.muted }));
}

/**
 * Join, leave or change mute. Only seated humans can talk. Returns { ok, changed } or { ok: false, error }.
 */
function setVoice(room, playerId, on, muted = false) {
  const member = room.members.find((m) => m.id === playerId && !m.bot);
  if (!member) return { ok: false, error: 'Take a seat to talk' };
  const map = voiceOf(room);
  if (!on) return { ok: true, changed: map.delete(playerId) };
  if (!map.has(playerId) && map.size >= MAX_VOICE) return { ok: false, error: `Voice is full (${MAX_VOICE} people)` };
  const before = map.get(playerId);
  map.set(playerId, { muted: !!muted });
  return { ok: true, changed: !before || before.muted !== !!muted };
}

/** Remove someone (they left the table or lost their connection). True when the list changed. */
function dropVoice(room, playerId) {
  return room.voice ? room.voice.delete(playerId) : false;
}

/** Keep only what the browsers need; anything else (or anything too large) is dropped. */
function cleanSignal(data) {
  if (!data || typeof data !== 'object' || !KINDS.has(data.kind)) return null;
  if (data.kind === 'ice') {
    const c = data.candidate;
    if (c === null) return { kind: 'ice', candidate: null }; // end of candidates
    if (!c || typeof c !== 'object' || typeof c.candidate !== 'string') return null;
    const out = { kind: 'ice', candidate: { candidate: c.candidate } };
    if (typeof c.sdpMid === 'string') out.candidate.sdpMid = c.sdpMid;
    if (Number.isInteger(c.sdpMLineIndex)) out.candidate.sdpMLineIndex = c.sdpMLineIndex;
    return JSON.stringify(out).length <= MAX_SIGNAL_BYTES ? out : null;
  }
  if (typeof data.sdp !== 'string' || data.sdp.length > MAX_SIGNAL_BYTES) return null;
  return { kind: data.kind, sdp: data.sdp };
}

/**
 * Pass a setup message from one person in voice to another. `deliver(toId, message)` does the sending.
 * Both people must be in voice at the same table.
 */
function relay(room, fromId, toId, data, deliver) {
  const map = voiceOf(room);
  if (typeof toId !== 'string' || toId === fromId) return { ok: false, error: 'Bad voice target' };
  // Both ends must be current seated humans at this table, not just entries left in the voice map (a kicked or left player may still be there).
  if (!isSeatedHuman(room, fromId) || !isSeatedHuman(room, toId)) return { ok: false, error: 'Not in voice' };
  if (!map.has(fromId) || !map.has(toId)) return { ok: false, error: 'Not in voice' };
  const clean = cleanSignal(data);
  if (!clean) return { ok: false, error: 'Bad voice message' };
  deliver(toId, { t: 'rtc', from: fromId, data: clean });
  return { ok: true };
}

const TURN_TTL_DEFAULT = 3600; // one hour is ample for a voice session; a reconnect asks for a fresh welcome
const TURN_TTL_MIN = 300;
const TURN_TTL_MAX = 86400;

/**
 * A short-lived TURN login for one player, in the common TURN REST scheme: username "<expiry unix seconds>:<player id>",
 * credential base64(HMAC-SHA1(shared secret, username)). The TURN server checks the same HMAC and the expiry, so a leaked
 * credential stops working on its own, and the shared secret never leaves the server.
 */
function turnRestCredential(secret, playerId, { now = Date.now(), ttlSeconds = TURN_TTL_DEFAULT } = {}) {
  const ttl = Math.min(TURN_TTL_MAX, Math.max(TURN_TTL_MIN, Math.floor(Number(ttlSeconds) || TURN_TTL_DEFAULT)));
  const expiresAt = Math.floor(now / 1000) + ttl;
  const username = `${expiresAt}:${playerId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiresAt };
}

/**
 * ICE servers sent to browsers: STUN by default, plus TURN when configured (needed on strict networks).
 *
 * With TURN_SHARED_SECRET set, TURN gets a per-player, time-limited login (see turnRestCredential) and is offered only when
 * the caller names the player. Without it, the static TURN_USERNAME / TURN_CREDENTIAL pair is sent to everyone, as before:
 * prefer the shared secret, because a static pair is visible to every visitor and cannot be revoked for one of them.
 */
function iceServers(env = process.env, { playerId = null, now = Date.now() } = {}) {
  if (env.ICE_SERVERS) {
    try {
      const parsed = JSON.parse(env.ICE_SERVERS);
      if (Array.isArray(parsed) && parsed.every((s) => s && (typeof s.urls === 'string' || Array.isArray(s.urls)))) return parsed;
    } catch { /* fall through to the defaults */ }
  }
  const out = [{ urls: env.STUN_URL || DEFAULT_STUN }];
  if (env.TURN_URL && env.TURN_SHARED_SECRET) {
    if (playerId) {
      const c = turnRestCredential(env.TURN_SHARED_SECRET, playerId, { now, ttlSeconds: env.TURN_TTL_SECONDS });
      out.push({ urls: env.TURN_URL, username: c.username, credential: c.credential });
    }
  } else if (env.TURN_URL) {
    out.push({ urls: env.TURN_URL, username: env.TURN_USERNAME || '', credential: env.TURN_CREDENTIAL || '' });
  }
  return out;
}

/**
 * When the time-limited TURN logins in an ICE list stop working, as epoch milliseconds (the earliest one), or null when the
 * list has none. A per-player login carries its expiry (unix seconds) as the prefix of its username.
 */
function iceExpiresAt(list) {
  let earliest = null;
  for (const s of Array.isArray(list) ? list : []) {
    const m = s && typeof s.username === 'string' ? /^(\d+):/.exec(s.username) : null;
    if (!m) continue;
    const at = Number(m[1]) * 1000;
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest;
}

module.exports = { DEFAULT_STUN, MAX_VOICE, MAX_SIGNAL_BYTES, voiceList, setVoice, dropVoice, isSeatedHuman, cleanSignal, relay, iceServers, turnRestCredential, iceExpiresAt };
