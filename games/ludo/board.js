'use strict';
// The six-arm Ludo board for 5-6 players, as data on a hex grid (axial coordinates q, r).
//
// Six arms point out from the centre, 60 degrees apart. An arm is three hexes wide: its two side columns are the
// track, and the middle column is the seat's home lane (five squares running in to the centre). The track is the outer
// outline of the whole star, walked once round, so every track square has exactly two track neighbours. The arms
// zip together near the centre; the outline runs around that zip, so no separate notch squares are needed.
// Each seat starts on the middle square of its own arm's tip. Yards sit in the wedges between arms, outside the star.
// The server and the browser both read this file's output (the browser gets it in the table view), so both agree.

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]; // the six hex neighbours, in order round the hex
const ARM = 2; // distance of the first arm square from the centre (the centre holds the 7 hexes nearer than this)
const TIP = ARM + 5; // distance of the tip from the centre: the home lane is the five squares before it
const key = (q, r) => `${q},${r}`;
const hexDist = (q, r) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;

function build() {
  // every square that belongs to the star, with its role
  const solid = new Map();
  for (let q = -TIP - 1; q <= TIP + 1; q++) for (let r = -TIP - 1; r <= TIP + 1; r++) {
    if (hexDist(q, r) < ARM) solid.set(key(q, r), { q, r, role: 'centre' });
  }
  for (let k = 0; k < 6; k++) {
    const d = DIRS[k], e = DIRS[(k + 1) % 6];
    for (let s = ARM; s <= TIP; s++) for (const o of [-1, 0, 1]) {
      const q = s * d[0] + o * e[0], r = s * d[1] + o * e[1];
      const role = o !== 0 ? 'track' : s === TIP ? 'start' : 'lane';
      solid.set(key(q, r), { q, r, role, seat: k, s, o });
    }
  }
  // the outline: star squares with a neighbour outside the star
  const outline = [...solid.values()].filter((c) => c.role !== 'centre' && DIRS.some(([dq, dr]) => !solid.has(key(c.q + dq, c.r + dr))));
  const outSet = new Set(outline.map((c) => key(c.q, c.r)));
  // walk the outline: at each square take the first unvisited outline neighbour, turning from the way we arrived
  const start = outline.find((c) => c.role === 'start' && c.seat === 0);
  const order = [];
  const visited = new Set();
  let cur = start, back = null;
  while (cur) {
    order.push(cur); visited.add(key(cur.q, cur.r));
    const base = back === null ? 0 : (back + 4) % 6;
    let nxt = null, dirUsed = null;
    for (let t = 1; t <= 6 && !nxt; t++) {
      const di = (base + t) % 6;
      const k = key(cur.q + DIRS[di][0], cur.r + DIRS[di][1]);
      if (outSet.has(k) && !visited.has(k)) { nxt = solid.get(k); dirUsed = di; }
    }
    if (!nxt) break;
    back = (dirUsed + 3) % 6;
    cur = nxt;
  }
  if (order.length !== outline.length) throw new Error(`ludo board: outline walk covered ${order.length} of ${outline.length}`);
  const index = new Map(order.map((c, i) => [key(c.q, c.r), i]));
  const starts = [];
  for (let k = 0; k < 6; k++) starts.push(index.get(key(TIP * DIRS[k][0], TIP * DIRS[k][1])));
  // each seat's home lane, from the square next to the track outwards to the centre; lane[0] sits beside the tip
  const lanes = [];
  for (let k = 0; k < 6; k++) {
    const lane = [];
    for (let s = TIP - 1; s >= ARM; s--) lane.push({ q: s * DIRS[k][0], r: s * DIRS[k][1] });
    lanes.push(lane);
  }
  // the square the track reaches just before a seat's start must sit beside its home lane, so tokens turn in cleanly
  return { order, starts, lanes, solid, outSet, index };
}

const built = build();
const TRACK = built.order.length;
const STARTS = built.starts;
// a hex's position in the browser: pointy-top hexes, with the whole board fitted to 100 x 100
const pixel = (q, r) => [Math.sqrt(3) * (q + r / 2), 1.5 * r];
const all = [...built.solid.values()].map((c) => pixel(c.q, c.r));
const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
const scale = 92 / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
const at = (q, r) => { const p = pixel(q, r); return [50 + (p[0] - cx) * scale, 50 + (p[1] - cy) * scale]; };

// the safe squares: each start, and the square four steps round the track after it (the star on the cross board is eight
// steps after its start; this board is wider, so four steps round keeps the same feel)
const SAFE = new Set();
for (const s of STARTS) { SAFE.add(s); SAFE.add((s + 4) % TRACK); }

// What the browser draws, in 100 x 100 board units. Sent once in the table view for 5-6 players.
const PITCH = Math.sqrt(3) * scale; // the distance between neighbouring squares
function boardView() {
  const centre = [];
  for (const c of built.solid.values()) if (c.role === 'centre') centre.push({ at: at(c.q, c.r), seat: DIRS.findIndex(([a, b]) => a === c.q && b === c.r) });
  const yards = [];
  for (let k = 0; k < 6; k++) {
    const d = DIRS[k], e = DIRS[(k + 1) % 6];
    yards.push(at(3 * (d[0] + e[0]), 3 * (d[1] + e[1]))); // the wedge clockwise from arm k, clear of the track
  }
  return {
    pitch: PITCH,
    track: built.order.map((c) => at(c.q, c.r)),
    starts: STARTS,
    lanes: built.lanes.map((l) => l.map((c) => at(c.q, c.r))),
    centre, // the seven centre squares; seat k's own square is the one at its arm
    yards,
    safe: [...SAFE],
  };
}
let cachedView = null;
const viewOfBoard = () => cachedView || (cachedView = boardView());

module.exports = { DIRS, ARM, TIP, TRACK, STARTS, SAFE, order: built.order, lanes: built.lanes, index: built.index, at, pixel, boardView: viewOfBoard };
