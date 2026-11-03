'use strict';
/**
 * Layout audit for every table game (not Ludo, which has its own checks) in a real browser. Plays REAL engines forward to
 * four moments (start, early, late, over), renders each at six screen sizes and reports: sideways scrolling, controls cut
 * off by the screen edge, controls that overlap each other, small tap targets, clipped text, hand cards that are too
 * small. Not part of `npm test` (needs a browser). Usage:
 *   node tests/ui/game-audit.js                      all games, prints findings, exit 1 if any ERROR
 *   UI_GAME=poker UI_SEATS=6 node tests/ui/game-audit.js
 *   UI_SHOTS=/some/dir node tests/ui/game-audit.js   also saves a screenshot of every case
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('SKIPPED: playwright is not installed'); process.exit(0); }
const games = require('../../games');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };
const CASES = process.env.UI_GAME ? [[process.env.UI_GAME, Number(process.env.UI_SEATS || 4)]]
  : [['wizard', 3], ['wizard', 6], ['twentynine', 4], ['poker', 2], ['poker', 6], ['poker', 8], ['themind', 2], ['themind', 4], ['gofish', 2], ['gofish', 4], ['gofish', 6]].concat(games.get('snakesladders') ? [['snakesladders', 2], ['snakesladders', 4]] : []);
const SIZES = [
  { name: '320x568', width: 320, height: 568 }, { name: '360x640', width: 360, height: 640 }, { name: '390x844', width: 390, height: 844 },
  { name: '667x375', width: 667, height: 375 }, { name: '768x1024', width: 768, height: 1024 }, { name: '1280x800', width: 1280, height: 800 },
];
const NAMES = ['Aarav the Magnificent', 'Bo', 'Charlotte-Anne', 'Dmitri', 'Eve', 'Frederick', 'Giuseppe', 'Hannah'];
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Plays bots forward. stopAt(g, steps) decides when to stop; the loop only stops on a moment where p0 has something to do. */
function states(gameId, n) {
  const def = games.get(gameId);
  const players = NAMES.slice(0, n).map((name, i) => ({ id: 'p' + i, name, avatar: '🧙' }));
  const opts = Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default]));
  const g = def.create(players, { ...opts, timeLimit: 'off' }, mulberry(7));
  const out = [];
  const snap = (label) => out.push({ label, players, g, view: JSON.parse(JSON.stringify(g.view('p0'))) });
  const step = () => {
    const w = [].concat(g.awaiting() || []);
    if (!w.length) { const a = g.autoAction && g.autoAction(); if (!a) return false; g.act(null, a); return true; }
    const f = g.forcedPlay && g.forcedPlay();
    const id = f ? f.playerId : w[0];
    const r = g.act(id, f ? f.action : g.botAction(id));
    return r && r.ok !== false;
  };
  const advance = (steps) => {
    let i = 0;
    while (i < steps && !g.isOver() && step()) i++;
    // settle on a moment where it is p0's move, if that comes soon
    for (let k = 0; k < 40 && !g.isOver() && !g.view('p0').myTurn; k++) if (!step()) break;
  };
  snap('start');
  advance(8); snap('early');
  advance(60); snap('late');
  for (let i = 0; i < 6000 && !g.isOver() && step(); i++);
  if (g.isOver()) snap('over');
  return out;
}

function roomFor(gameId, n, players) {
  const def = games.get(gameId);
  return { code: 'ABCDEF', gameId, hostId: 'p0', status: 'playing', options: {}, visibility: 'public', seats: n, min: def.seats.min, max: def.seats.max, seatLabels: def.seatLabel ? players.map((_, i) => def.seatLabel(i, n)) : null,
    members: players.map((p, i) => ({ id: p.id, name: p.name, bot: i > 0 && i % 2 === 0, avatar: p.avatar, connected: true })), spectators: [], deadline: null, now: Date.now() };
}

function serve() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/api/auth/session') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: true, authenticated: true, player: { display_name: NAMES[0], username: 'aarav', avatar: '🧙', email: 'a@b.c' }, emailVerified: true, csrfToken: 'x' })); }
    if (rel.startsWith('/api/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: true, tables: [], games: [], players: [], friends: [], requests: [], invitations: [] })); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(d); });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** Runs in the page. Returns findings [{sev, kind, msg}] and a few measurements. */
function inPage() {
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const out = { findings: [], info: {} };
  const add = (sev, kind, msg) => out.findings.push({ sev, kind, msg });
  const visible = (el) => {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden || Number(cs.opacity) === 0) return false; }
    return true;
  };
  const label = (el) => (el.getAttribute('aria-label') || el.dataset.act || el.dataset.gf || el.dataset.sl || el.className || el.tagName).toString().trim().slice(0, 40) + (el.textContent ? ' "' + el.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) + '"' : '');
  const scrollParent = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) return e; } return null; };

  if (document.documentElement.scrollWidth > vw + 1) add('ERROR', 'overflow', `page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  const overlay = document.querySelector('.overlay');
  const scope = overlay ? overlay : document.querySelector('.wz') || document.getElementById('app');
  const all = [...scope.querySelectorAll('*')].filter(visible);

  // cut off by the screen edge
  for (const el of all) {
    if (el.closest('svg') && el.tagName !== 'svg') continue;
    const r = el.getBoundingClientRect();
    if ((r.left < -1 || r.right > vw + 1) && !scrollParent(el) && !el.closest('.hand')) {
      const interactive = el.matches('button, a, input, select, .card, .pt-seat, [data-act], [data-gf], [data-sl]');
      if (interactive) add('ERROR', 'cut-off', `${label(el)} leaves the screen (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`);
    }
  }
  // overlaps between controls and seats (a fanned hand overlaps by design, so cards are not compared with each other)
  const cand = all.filter((el) => el.matches('button, a.btn, input, select, .pt-seat, .wz-status, .wz-top, .bidbox, .gf-ask, .sl-panel, .sl-players li, .sl-feedback') && !el.parentElement.closest('button'));
  const inter = (a, b) => { const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)); return x * y; };
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
    const a = cand[i], b = cand[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const area = inter(ra, rb);
    if (area > 0 && area / Math.min(ra.width * ra.height, rb.width * rb.height) > 0.2) add('ERROR', 'overlap', `${label(a)} overlaps ${label(b)} (${Math.round(area)}px2)`);
  }
  // cards drawn over controls or seats
  const cards = all.filter((el) => el.matches('.card') && !el.closest('.hand') && !el.closest('.overlay'));
  const blockers = all.filter((el) => el.matches('button, .pt-seat, .wz-status, .bidbox') && !el.closest('.card'));
  for (const c of cards) for (const b of blockers) {
    if (c.contains(b) || b.contains(c)) continue;
    const rc = c.getBoundingClientRect(), rb = b.getBoundingClientRect(); const area = inter(rc, rb);
    if (area > 0 && area / Math.min(rc.width * rc.height, rb.width * rb.height) > 0.3) add('ERROR', 'covers', `card ${label(c)} covers ${label(b)}`);
  }
  // small tap targets and clipped text
  for (const el of all) {
    if (el.matches('button:not(:disabled), a.btn, select, input:not([type=hidden])')) {
      const r = el.getBoundingClientRect();
      if (Math.min(r.width, r.height) < 30) add('WARN', 'tap-target', `${label(el)} is ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    if (el.matches('button, .pt-seat .nm, .wz-status span, h1, h2, h3, b') && el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(getComputedStyle(el).overflowX) && getComputedStyle(el).textOverflow !== 'ellipsis') add('WARN', 'clipped-text', `${label(el)} text is cut (${el.scrollWidth} > ${el.clientWidth})`);
  }
  // hand cards
  const hand = [...document.querySelectorAll('.hand .card')].filter(visible);
  if (hand.length) {
    const w = Math.min(...hand.map((c) => c.getBoundingClientRect().width));
    out.info.handCard = Math.round(w);
    if (w < 34) add('WARN', 'small-cards', `hand cards are ${Math.round(w)}px wide`);
    const lowest = Math.max(...hand.map((c) => c.getBoundingClientRect().bottom));
    if (lowest > vh + 1) add('WARN', 'below-fold', `hand ends at ${Math.round(lowest)} (screen ${vh})`);
  }
  const prime = [...document.querySelectorAll('.btn.big, [data-gf=ask], [data-sl=roll], .bidbtn')].filter(visible);
  for (const b of prime) if (b.getBoundingClientRect().bottom > vh + 1 && !b.closest('.overlay')) { add('WARN', 'below-fold', `${label(b)} needs scrolling (bottom ${Math.round(b.getBoundingClientRect().bottom)} of ${vh})`); break; }
  out.info.pageH = document.documentElement.scrollHeight; out.info.vh = vh;
  return out;
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch();
  const shots = process.env.UI_SHOTS; if (shots) fs.mkdirSync(shots, { recursive: true });
  const all = [];
  for (const [game, n] of CASES) {
    for (const st of states(game, n)) {
      const msgs = [
        { t: 'welcome', id: 'p0', name: NAMES[0], avatar: '🧙', avatars: ['🧙'], emotes: ['👍'], games: games.list(), tables: [], rejoin: [] },
        { t: 'state', room: roomFor(game, n, st.players), view: st.view },
      ];
      for (const size of SIZES) {
        const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, hasTouch: size.width < 800 });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript((messages) => {
          window.WebSocket = class {
            constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 0); }
            send(raw) { let m; try { m = JSON.parse(raw); } catch { return; } if (m.t === 'hello') messages.forEach((x, i) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(x) }), 10 * (i + 1))); }
            close() { this.readyState = 3; }
          };
        }, msgs);
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForSelector('.wz-top, .sl', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(250);
        const r = await page.evaluate(inPage);
        for (const e of errors) r.findings.push({ sev: 'ERROR', kind: 'js-error', msg: e });
        const tag = `${game}-${n}p ${st.label} ${size.name}`;
        for (const f of r.findings) all.push({ tag, ...f });
        if (shots) await page.screenshot({ path: path.join(shots, `${game}-${n}-${st.label}-${size.name}.png`) });
        await ctx.close();
      }
    }
  }
  await browser.close(); server.close();
  // group identical messages across sizes/states so the report stays readable
  const groups = new Map();
  for (const f of all) { const key = `${f.sev} ${f.kind}: ${f.msg.replace(/\d+/g, '#')}`; const g = groups.get(key) || { n: 0, first: f }; g.n++; groups.set(key, g); }
  const sorted = [...groups.entries()].sort((a, b) => (a[0].startsWith('ERROR') ? 0 : 1) - (b[0].startsWith('ERROR') ? 0 : 1) || b[1].n - a[1].n);
  for (const [key, g] of sorted) console.log(`${String(g.n).padStart(4)}x ${key}\n        e.g. ${g.first.tag}: ${g.first.msg}`);
  const errors = all.filter((f) => f.sev === 'ERROR').length;
  console.log(`\n${CASES.length} game setups, ${errors} errors, ${all.length - errors} warnings`);
  if (errors) process.exitCode = 1;
})();
