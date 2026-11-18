'use strict';
require('./helpers/env');
// Guest play on a REAL PostgreSQL (throw-away database, tests/helpers/testdb.js): a guest's own row becomes the account on
// upgrade (same id, same matches), a refused upgrade changes nothing, and expiry removes only ended guests.
// Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Browser, registerAndVerify } = require('./helpers/auth');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });
const PW = 'TestPass123!';

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-guestpg-'));
  process.env.MATCH_SPOOL_DIR = spool;
  process.env.GUEST_PLAY_ENABLED = 'true';
  process.env.GUEST_SESSION_TTL_HOURS = '24';
  try {
    process.env.DATABASE_URL = t.url;
    const dbPool = require('../db/pool');
    const dbMatches = require('../db/matches');
    const dbAuth = require('../db/auth');
    const { start } = require('../server');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    const fast = { port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchRetryDelays: [20, 40, 80], matchLog: quiet() };
    const srv = await start(fast);
    assert.equal(srv.database.mode, 'postgres');
    const record = (over) => dbMatches.recordMatch({ matchKey: crypto.randomUUID(), roomCode: 'GUEST1', gameId: 'ludo', seats: 2, options: {}, ...over });
    const part = (id, name, o = {}) => ({ playerId: id, name, seat: 0, score: 10, isWinner: false, isBot: false, leftEarly: false, ...o });

    let seq = 1;
    const newGuest = async (name = 'Ann') => {
      const b = new Browser(srv.port); await b.csrf();
      const r = await b.must('/api/auth/guest', { displayName: name });
      return { browser: b, id: r.json.player.id, name: r.json.player.name, csrf: r.json.csrfToken };
    };
    const newUser = async (tag) => {
      const email = `${tag}.${seq}@test.local`; const username = `${tag}${seq++}`.slice(0, 24);
      const u = await registerAndVerify(srv.port, { email, username, displayName: tag, password: PW });
      return { ...u, email, id: (await u.browser.get("/api/auth/session")).json.player.id };
    };

    await test('a guest is an is_anonymous row with a session that lasts the guest lifetime, not 30 days', async () => {
      const g = await newGuest('Ann');
      const [row] = await q('SELECT is_anonymous, username, display_name FROM players WHERE id = $1', [g.id]);
      assert.equal(row.is_anonymous, true);
      assert.equal(row.username, null);
      assert.equal(row.display_name, 'Ann');
      const [s] = await q('SELECT EXTRACT(EPOCH FROM (expires_at - NOW()))::int AS secs FROM auth_sessions WHERE player_id = $1', [g.id]);
      assert.ok(s.secs > 23 * 3600 && s.secs <= 24 * 3600, 'about 24 hours: ' + s.secs);
    });

    await test('a second guest with the same name gets a four-digit number added', async () => {
      await newGuest('Sam');
      const second = await newGuest('Sam');
      assert.match(second.name, /^Sam\d{4}$/);
    });

    await test('upgrade keeps the same player row and its matches (nothing copied, nothing lost)', async () => {
      const g = await newGuest('Gina');
      await record({ participants: [part(g.id, 'Gina', { score: 40, isWinner: true }), part(null, 'Bot', { isBot: true, seat: 1 })] });
      const before = await q('SELECT match_id FROM match_participants WHERE player_id = $1', [g.id]);
      assert.equal(before.length, 1);
      const r = await g.browser.must('/api/auth/upgrade-guest', { email: `gina.${seq}@test.local`, username: `gina${seq++}`, password: PW, adultConfirmed: true }, { csrf: true });
      assert.equal(r.json.upgraded, true);
      assert.equal(r.json.player.id, g.id, 'same id');
      const [row] = await q('SELECT is_anonymous, username FROM players WHERE id = $1', [g.id]);
      assert.equal(row.is_anonymous, false);
      assert.ok(row.username, 'username set');
      const after = await q('SELECT match_id FROM match_participants WHERE player_id = $1', [g.id]);
      assert.deepEqual(after.map((r2) => r2.match_id), before.map((r2) => r2.match_id), 'the same match is still attached');
      assert.equal((await q('SELECT count(*)::int AS n FROM players WHERE display_name = $1', ['Gina']))[0].n, 1, 'no duplicate row');
    });

    await test('the session survives the upgrade; the e-mail is unverified until the link is used', async () => {
      const g = await newGuest('Hal');
      await g.browser.must('/api/auth/upgrade-guest', { email: `hal.${seq}@test.local`, username: `hal${seq++}`, password: PW, adultConfirmed: true });
      const s = (await g.browser.get('/api/auth/session')).json;
      assert.equal(s.authenticated, true, 'still signed in');
      assert.equal(s.player.username !== null, true);
      assert.equal(s.emailVerified, false);
    });

    await test('an upgrade with a taken username or e-mail is refused and changes nothing', async () => {
      const taken = await newUser('taken');
      const g = await newGuest('Ivy');
      const e1 = await g.browser.post('/api/auth/upgrade-guest', { email: `ivy.${seq}@test.local`, username: taken.username, password: PW, adultConfirmed: true });
      assert.equal(e1.status, 400);
      assert.match(e1.json.error, /already taken/);
      const e2 = await g.browser.post('/api/auth/upgrade-guest', { email: taken.email, username: `ivy${seq++}`, password: PW, adultConfirmed: true });
      assert.equal(e2.status, 409);
      assert.equal((await q('SELECT is_anonymous FROM players WHERE id = $1', [g.id]))[0].is_anonymous, true, 'still a guest');
    });

    await test('a registered player can still create a game that is disabled for guests only', async () => {
      const gameFlags = require('../lib/gameFlags');
      const dbAdmin = require('../db/admin');
      const WebSocket = require('ws');
      const { sessionSocket } = require('./helpers/auth');
      await x.query("INSERT INTO game_flags (game_id, enabled, access) VALUES ('wizard', FALSE, 'guests') ON CONFLICT (game_id) DO UPDATE SET access = 'guests', enabled = FALSE");
      gameFlags.apply(await dbAdmin.listGameFlags(), gameFlags.begin());
      try {
        const u = await newUser('wiz');
        const msgs = [];
        const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, sessionSocket(u.token));
        ws.on('message', (d) => msgs.push(JSON.parse(d)));
        await new Promise((resolve) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello' })); setTimeout(resolve, 300); }));
        ws.send(JSON.stringify({ t: 'create', gameId: 'wizard' }));
        await new Promise((r) => setTimeout(r, 300));
        ws.close();
        assert.equal(msgs.filter((m) => m.t === 'error' && m.code === 'guest_locked').length, 0, 'no account prompt for a registered player');
        assert.equal(msgs.filter((m) => m.t === 'error' && /not available/.test(m.message || '')).length, 0, 'not refused either');
      } finally {
        await x.query("UPDATE game_flags SET access = 'on', enabled = TRUE WHERE game_id = 'wizard'");
        gameFlags.apply(await dbAdmin.listGameFlags(), gameFlags.begin());
      }
    });

    await test('a registered player cannot use the guest upgrade', async () => {
      const u = await newUser('reg');
      const r = await u.browser.post('/api/auth/upgrade-guest', { email: `x.${seq}@test.local`, username: `xx${seq++}`, password: PW, adultConfirmed: true });
      assert.equal(r.status, 403);
    });

    await test('expiry removes an ended guest, keeps its finished games (unlinked), and never touches a registered account', async () => {
      const ended = await newGuest('Old');
      await record({ participants: [part(ended.id, 'Old', { score: 5 }), part(null, 'Bot', { isBot: true, seat: 1 })] });
      await q("UPDATE players SET created_at = NOW() - INTERVAL '3 days' WHERE id = $1", [ended.id]);
      await q("UPDATE auth_sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE player_id = $1", [ended.id]);
      const reg = await newUser('keep');
      const out = await dbAuth.purgeExpired();
      assert.ok(out.guests >= 1, JSON.stringify(out));
      assert.equal((await q('SELECT count(*)::int AS n FROM players WHERE id = $1', [ended.id]))[0].n, 0, 'the ended guest is removed');
      const kept = await q('SELECT player_name, player_id FROM match_participants WHERE player_name = $1', ['Old']);
      assert.equal(kept.length, 1, 'its finished game is still in the record');
      assert.equal(kept[0].player_id, null, 'the record is unlinked');
      assert.equal((await q('SELECT count(*)::int AS n FROM players WHERE id = $1', [reg.id]))[0].n, 1, 'registered account kept');
    });

    await test('a guest with a live session is not removed by expiry', async () => {
      const live = await newGuest('Live');
      await q("UPDATE players SET created_at = NOW() - INTERVAL '3 days' WHERE id = $1", [live.id]);
      await dbAuth.purgeExpired();
      assert.equal((await q('SELECT count(*)::int AS n FROM players WHERE id = $1', [live.id]))[0].n, 1);
    });

    await srv.close();
    await dbPool.close();
    console.log(`\n${passed} guest tests passed`);
  } finally {
    fs.rmSync(spool, { recursive: true, force: true });
    await t.drop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
