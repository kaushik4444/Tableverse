'use strict';
/**
 * Carrom physics, pure and deterministic: no clock, no I/O. The board is a unit square (0..1 on both axes); the four corners
 * are pockets. A shot is simulated on the server and the clients only replay the keyframes it returns.
 *
 * Discs: { id, kind: 'coin' | 'queen' | 'striker', x, y, vx, vy, r, colour }. Equal masses; collisions exchange momentum along
 * the line of centres with restitution RESTITUTION. Friction removes speed at a constant rate. A disc whose centre comes
 * within POCKET_R of a corner is pocketed and leaves the board.
 */

const RADIUS = { coin: 0.022, queen: 0.022, striker: 0.026 };
const POCKET_R = 0.05;
const CORNERS = [[0, 0], [1, 0], [0, 1], [1, 1]];
const DECEL = 3.0;          // friction, units per second squared (a full flick travels about 0.96 units)
const RESTITUTION = 0.92;   // disc against disc
const CUSHION = 0.75;       // disc against the edge of the board
const MAX_SPEED = 2.4;      // a full-power flick, units per second
const DT = 1 / 240;         // fixed time step
const MAX_TIME = 20;        // seconds of simulated play before the shot is stopped
const SETTLE_SPEED = 0.01;  // every disc slower than this has stopped
const SAMPLE_EVERY = 8;     // keyframe every 8 steps (30 per second)
const ANGLE_LIMIT = 75 * Math.PI / 180;

/**
 * The velocity of a flick: angle from straight ahead (positive to the player's right), power 0..1. `forward` is +1 for the
 * player at the bottom of the board and -1 for the player at the top, whose right is the board's left.
 * Speed grows with the square root of power, so the distance a disc slides (speed squared over friction) grows in a straight
 * line with power: a drag twice as long slides the striker twice as far.
 */
function flickVelocity(angle, power, forward = 1) {
  const speed = Math.sqrt(Math.max(0, Math.min(1, power))) * MAX_SPEED;
  return { vx: forward * speed * Math.sin(angle), vy: forward * speed * Math.cos(angle) };
}

const round = (n) => Math.round(n * 1000) / 1000;
const speedOf = (d) => Math.hypot(d.vx, d.vy);

/** Advances the discs by one fixed step in place. Returns the discs pocketed in this step, in order. */
function step(discs) {
  const pocketed = [];
  for (const d of discs) {
    d.x += d.vx * DT;
    d.y += d.vy * DT;
    const s = speedOf(d);
    if (s > 0) {
      const ns = Math.max(0, s - DECEL * DT);
      d.vx *= ns / s;
      d.vy *= ns / s;
    }
  }
  // Pockets are checked before the cushions: a disc that has reached a pocket is taken, not clamped and bounced back out.
  for (let i = discs.length - 1; i >= 0; i--) {
    const d = discs[i];
    if (CORNERS.some(([cx, cy]) => Math.hypot(d.x - cx, d.y - cy) < POCKET_R)) {
      pocketed.unshift(d);
      discs.splice(i, 1);
    }
  }
  for (const d of discs) {
    if (d.x < d.r) { d.x = d.r; d.vx = -d.vx * CUSHION; }
    if (d.x > 1 - d.r) { d.x = 1 - d.r; d.vx = -d.vx * CUSHION; }
    if (d.y < d.r) { d.y = d.r; d.vy = -d.vy * CUSHION; }
    if (d.y > 1 - d.r) { d.y = 1 - d.r; d.vy = -d.vy * CUSHION; }
  }
  for (let i = 0; i < discs.length; i++) {
    for (let j = i + 1; j < discs.length; j++) {
      collide(discs[i], discs[j]);
    }
  }
  return pocketed;
}

function collide(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (dist >= min || dist === 0) return;
  const nx = dx / dist, ny = dy / dist;
  const overlap = (min - dist) / 2; // separate so they stop sticking together
  a.x -= nx * overlap; a.y -= ny * overlap;
  b.x += nx * overlap; b.y += ny * overlap;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return; // already separating
  const j = (1 + RESTITUTION) * vn / 2;
  a.vx += j * nx; a.vy += j * ny;
  b.vx -= j * nx; b.vy -= j * ny;
}

const snapshot = (discs) => discs.map((d) => [d.id, round(d.x), round(d.y)]);

/**
 * Runs a shot until every disc stops (or MAX_TIME passes). `discs` are copied, not changed.
 * Returns { discs (those still on the board), pocketed: [{ id, kind, colour }], keyframes: [{ t, d: [[id, x, y]] }], settled }.
 */
function simulate(input) {
  const discs = input.map((d) => ({ ...d }));
  const kinds = new Map(input.map((d) => [d.id, d]));
  const pocketed = [];
  const keyframes = [{ t: 0, d: snapshot(discs) }];
  const maxSteps = Math.round(MAX_TIME / DT);
  let settled = false;
  for (let k = 1; k <= maxSteps; k++) {
    for (const p of step(discs)) pocketed.push({ id: p.id, kind: kinds.get(p.id).kind, colour: kinds.get(p.id).colour });
    if (k % SAMPLE_EVERY === 0) keyframes.push({ t: round(k * DT), d: snapshot(discs) });
    if (discs.every((d) => speedOf(d) < SETTLE_SPEED)) { settled = true; keyframes.push({ t: round(k * DT), d: snapshot(discs) }); break; }
  }
  if (!settled) keyframes.push({ t: round(maxSteps * DT), d: snapshot(discs) });
  // Discs that did not stop before the time limit are left where they are.
  return { discs, pocketed, keyframes, settled };
}

module.exports = { RADIUS, POCKET_R, CORNERS, MAX_SPEED, DT, MAX_TIME, ANGLE_LIMIT, flickVelocity, simulate, step };
