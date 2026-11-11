'use strict';
// The six-arm Ludo board for 5-6 players, laid out like the printed six-player boards.
//
// A regular hexagon sits in the middle (the home). From each of its six edges an arm runs straight out: three squares
// wide and six long, squares lined up with the arm. The arms point up, up-right, down-right, down, down-left and up-left.
// An arm's middle column is that seat's home lane (five squares); the square at its tip carries an arrow pointing in
// (a token turns into the lane there). The seat's start, where tokens enter, is the bottom square of the arm's right
// column, coloured. The two outer columns are track. The track goes once round the outside of the star: out along an
// arm's left column, across its start, back along its right column, then on to the next arm. A yard is the equilateral
// triangle between two arms, with its point on a corner of the hexagon.
// The server and the browser both use this file's output (the browser gets it in the table view), so they agree.

const SIDE = 3; // squares along each edge of the centre hexagon (and the width of an arm)
const LEN = 6; // squares along each arm: five of home lane plus the start at the tip
const APOTHEM = (SIDE * Math.sqrt(3)) / 2; // centre of the hexagon to the middle of an edge
const rad = (deg) => (deg * Math.PI) / 180;
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const mul = (p, s) => [p[0] * s, p[1] * s];
const dir = (deg) => [Math.cos(rad(deg)), Math.sin(rad(deg))];
const armDeg = (k) => -90 + 60 * k; // seat k's arm points up for seat 0 and runs clockwise (y points down)

// centre of the square at `row` (1 is next to the hexagon, LEN is the tip) and `col` (-1 left, 0 middle, +1 right) of arm k
function cell(k, row, col) {
  const a = dir(armDeg(k)), l = dir(armDeg(k) + 90);
  return add(mul(a, APOTHEM + row - 0.5), mul(l, col));
}

// the track in order: per arm, the left column outwards, the start, then the right column back in
const rawTrack = []; // [x, y, arm]
for (let k = 0; k < 6; k++) {
  for (let row = 1; row <= LEN; row++) rawTrack.push([...cell(k, row, -1), k]);
  rawTrack.push([...cell(k, LEN, 0), k]);
  for (let row = LEN; row >= 1; row--) rawTrack.push([...cell(k, row, 1), k]);
}
const PER_ARM = rawTrack.length / 6; // 13
const TRACK = rawTrack.length; // 78
const STARTS = [0, 1, 2, 3, 4, 5].map((k) => k * PER_ARM + LEN + 1); // the bottom square of the arm's right column
// safe squares: each start, and the third square from the bottom of the same right column (marked with a star)
const SAFE = new Set();
for (let k = 0; k < 6; k++) { SAFE.add(STARTS[k]); SAFE.add(STARTS[k] + 2); }
// each home lane, from the square beside the start in to the hexagon
const rawLanes = [];
for (let k = 0; k < 6; k++) { const lane = []; for (let row = LEN - 1; row >= 1; row--) lane.push([...cell(k, row, 0), k]); rawLanes.push(lane); }
const corner = (k) => mul(dir(armDeg(k) + 30), SIDE); // the hexagon corner between arm k and arm k+1
const yardTri = (k) => [corner(k), add(corner(k), mul(dir(armDeg(k)), LEN)), add(corner(k), mul(dir(armDeg(k + 1)), LEN))];

// fit the whole board into 100 x 100 units
const pts = [];
for (const [x, y] of [...rawTrack, ...rawLanes.flat()]) pts.push([x, y]);
for (let k = 0; k < 6; k++) pts.push(...yardTri(k), corner(k));
const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
const width = Math.max(...xs) - Math.min(...xs) + 1.2, height = Math.max(...ys) - Math.min(...ys) + 1.2;
const SCALE = 96 / Math.max(width, height); // units per square
const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
const fit = (p) => [50 + (p[0] - cx) * SCALE, 50 + (p[1] - cy) * SCALE];
const r2 = (n) => Math.round(n * 100) / 100;
const out = (p) => fit(p).map(r2);

function buildView() {
  return {
    size: r2(SCALE), // one square, in board units
    track: rawTrack.map(([x, y, k]) => ({ p: out([x, y]), ang: armDeg(k) })),
    starts: STARTS,
    safe: [...SAFE],
    lanes: rawLanes.map((lane) => lane.map(([x, y, k]) => ({ p: out([x, y]), ang: armDeg(k) }))),
    hexagon: [0, 1, 2, 3, 4, 5].map((k) => out(corner(k))),
    // the home triangle of each seat: the centre and the two hexagon corners either side of its arm
    homes: [0, 1, 2, 3, 4, 5].map((k) => [out([0, 0]), out(corner((k + 5) % 6)), out(corner(k))]),
    finished: [0, 1, 2, 3, 4, 5].map((k) => out(mul(dir(armDeg(k)), APOTHEM * 0.58))), // where a seat's home count sits
    yards: [0, 1, 2, 3, 4, 5].map((k) => {
      const tri = yardTri(k);
      const c = mul(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
      const b = dir(armDeg(k) + 30), p = dir(armDeg(k) + 120);
      const slot = (u, v) => out(add(c, add(mul(b, u), mul(p, v))));
      return { tri: tri.map(out), c: out(c), r: r2(1.5 * SCALE), slots: [slot(-0.75, -0.75), slot(0.75, -0.75), slot(-0.75, 0.75), slot(0.75, 0.75)] };
    }),
  };
}
let cached = null;
const boardView = () => cached || (cached = buildView());

module.exports = { SIDE, LEN, TRACK, STARTS, SAFE, PER_ARM, rawTrack, rawLanes, boardView };
