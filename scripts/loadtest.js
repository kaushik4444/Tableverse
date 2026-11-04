'use strict';
/**
 * Lightweight in-process load test (zero cost, no external services): starts the real server in memory mode, opens N
 * authenticated WebSocket players, seats them at tables of 4 with bots and plays real games, then reports memory,
 * event-loop delay, message volume and connection health.
 *
 *   NODE_ENV=test node scripts/loadtest.js [players=200] [seconds=20]
 *
 * It measures this machine only: use it to compare before/after a change, not as a capacity promise for Render's free plan.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.DATABASE_URL;
const WebSocket = require('ws');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { registerAndVerify } = require('../tests/helpers/auth');
const { start } = require('../server');

const PLAYERS = Number(process.argv[2] || 200);
const SECONDS = Number(process.argv[3] || 20);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => Math.round(n / 1048576);

(async () => {
  const srv = await start({ port: 0, trustProxy: false, botDelay: [150, 400], autoAdvanceMs: 200, trickPauseMs: 100, forcedMs: 100, maxMsgsPerSec: 200, maxSocketsPerIp: 100000, maxNewAccountsPerIp: 100000, maxNewAccountsPerMin: 100000, maxPlayers: 100000, maxPendingHellos: 100000 });
  const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
  const stats = { msgs: 0, bytes: 0, errors: 0, closed: 0, states: 0 };
  const clients = [];
  const t0 = Date.now();
  for (let i = 0; i < PLAYERS; i++) {
    const u = await registerAndVerify(srv.port, { email: `load${i}@test.local`, displayName: 'P' + i, password: 'TestPass123!' });
    const c = { i, ws: new WebSocket(`ws://127.0.0.1:${srv.port}/ws`), room: null, id: null, tables: [] };
    c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'hello', token: u.token })));
    c.ws.on('message', (raw) => {
      stats.msgs++; stats.bytes += raw.length;
      const m = JSON.parse(raw);
      if (m.t === 'welcome') c.id = m.id;
      if (m.t === 'state') { stats.states++; c.room = m.room; c.view = m.view; }
      if (m.t === 'error') stats.errors++;
      if (m.t === 'tables') c.tables = m.tables || [];
    });
    c.ws.on('close', () => { stats.closed++; });
    clients.push(c);
  }
  console.log(`registered ${PLAYERS} accounts in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await sleep(500);
  const game = (i) => ['gofish', 'wizard', 'twentynine', 'poker'][i % 4];
  // groups of 4: the first creates a public table, the rest join by code
  for (let g = 0; g < PLAYERS; g += 4) {
    const host = clients[g];
    host.ws.send(JSON.stringify({ t: 'create', gameId: game(g / 4), visibility: 'public' }));
    const t = Date.now(); while (!host.room && Date.now() - t < 5000) await sleep(5);
    if (!host.room) continue;
    for (let k = 1; k < 4 && g + k < PLAYERS; k++) clients[g + k].ws.send(JSON.stringify({ t: 'join', code: host.room.code }));
    await sleep(20);
    host.ws.send(JSON.stringify({ t: 'start' }));
  }
  const startMem = process.memoryUsage();
  const t1 = Date.now();
  // players act when it is their turn (via the view's own bot suggestion is not available to clients: let the server's
  // absent-player bot play instead; humans just stay connected and receive every update)
  await sleep(SECONDS * 1000);
  const end = process.memoryUsage();
  const open = clients.filter((c) => c.ws.readyState === 1).length;
  const finished = clients.filter((c) => c.room && c.room.status === 'finished').length;
  console.log(JSON.stringify({
    players: PLAYERS, seconds: SECONDS, connectionsOpen: open, closedUnexpectedly: stats.closed, errors: stats.errors,
    messages: stats.msgs, msgsPerSec: Math.round(stats.msgs / ((Date.now() - t1) / 1000)), kbPerSec: Math.round(stats.bytes / 1024 / ((Date.now() - t1) / 1000)),
    eventLoopDelayMs: { mean: +(h.mean / 1e6).toFixed(1), p99: +(h.percentile(99) / 1e6).toFixed(1), max: +(h.max / 1e6).toFixed(1) },
    rssMB: { start: mb(startMem.rss), end: mb(end.rss) }, heapMB: { start: mb(startMem.heapUsed), end: mb(end.heapUsed) }, playersInFinishedGames: finished,
  }, null, 1));
  for (const c of clients) c.ws.close();
  await srv.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
