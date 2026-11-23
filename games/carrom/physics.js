'use strict';
/**
 * Carrom physics, pure and deterministic: no clock, no I/O. The board is a unit square (0..1 on both axes); the four corners
 * are pockets. A shot is simulated on the server and the clients only replay the keyframes it returns.
 *
 * Discs: { id, kind: 'coin' | 'queen' | 'striker', x, y, vx, vy, r, colour }. Collisions exchange momentum along the line of
 * centres with restitution RESTITUTION, and the masses differ as on a real board: the striker is about 2.6 times as heavy as a
 * coin, so it carries on after it hits one (a "cut") instead of stopping dead, and a coin it hits is thrown faster than the
 * striker was going. Friction removes speed at a constant rate (a powdered board). A disc whose centre comes within POCKET_R of a
 * corner is pocketed and leaves the board.
 */

const RADIUS = { coin: 0.022, queen: 0.022, striker: 0.026 };
const MASS = { coin: 1, queen: 1.1, striker: 2.6 }; // relative: a real striker weighs about 15 g and a coin about 5.5 g
const POCKET_R = 0.045;
const CORNERS = [[0, 0], [1, 0], [0, 1], [1, 1]];
const DECEL = 1.5;          // friction, units per second squared (the same for every disc: a real board's friction is by weight)
const RESTITUTION = 0.9;    // disc against disc: wood on wood, lively
const CUSHION = 0.8;        // disc against the rubber-lined edge of the board
const MAX_SPEED = 2.1;      // a full-power flick, units per second: it slides about 1.5 board lengths, so it can cross the board and come back
const DT = 1 / 240;         // fixed time step
const MAX_TIME = 20;        // seconds of simulated play before the shot is stopped
const SETTLE_SPEED = 0.01;  // every disc slower than this has stopped
const SAMPLE_EVERY = 8;     // keyframe every 8 steps (30 per second)
const ANGLE_LIMIT = 75 * Math.PI / 180;
const PASSES = 4;           // overlap-resolution passes per step: a packed cluster settles in one step instead of drifting
const MIN_HIT = 0.05;       // an impact slower than this makes no sound
const HIT_MERGE = 0.025;    // impacts of one kind within this many seconds are one sound (the loudest)
const MAX_EVENTS = 60;

/** Event kinds in a shot's `events`: [time, kind, speed]. */
const HIT = 0;      // disc against disc
const CUSHION_HIT = 1;
const POCKET_FALL = 2;

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
const round2 = (n) => Math.round(n * 100) / 100;
const speedOf = (d) => Math.hypot(d.vx, d.vy);
const massOf = (d) => MASS[d.kind] || 1;

/** The cushions: a disc past an edge is put back on the board and its speed across that edge is reversed and reduced. */
function cushions(discs, ev) {
  for (const d of discs) {
    let hit = 0;
    if (d.x < d.r) { d.x = d.r; if (d.vx < 0) { hit = Math.max(hit, -d.vx); d.vx = -d.vx * CUSHION; } }
    if (d.x > 1 - d.r) { d.x = 1 - d.r; if (d.vx > 0) { hit = Math.max(hit, d.vx); d.vx = -d.vx * CUSHION; } }
    if (d.y < d.r) { d.y = d.r; if (d.vy < 0) { hit = Math.max(hit, -d.vy); d.vy = -d.vy * CUSHION; } }
    if (d.y > 1 - d.r) { d.y = 1 - d.r; if (d.vy > 0) { hit = Math.max(hit, d.vy); d.vy = -d.vy * CUSHION; } }
    if (ev && hit >= MIN_HIT) ev.push([CUSHION_HIT, hit]);
  }
}

/**
 * Two discs that overlap are pushed apart in proportion to how light each is, and if they are closing on each other they
 * exchange momentum along the line of centres. Returns true when they overlapped.
 */
function collide(a, b, ev) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const min = a.r + b.r;
  if (Math.abs(dx) >= min || Math.abs(dy) >= min) return false;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 === 0) return false;
  const dist = Math.sqrt(d2);
  const nx = dx / dist, ny = dy / dist;
  const ma = massOf(a), mb = massOf(b);
  const inv = 1 / ma + 1 / mb;
  const push = min - dist;
  a.x -= nx * push * (1 / ma) / inv; a.y -= ny * push * (1 / ma) / inv;
  b.x += nx * push * (1 / mb) / inv; b.y += ny * push * (1 / mb) / inv;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return true; // already separating
  const j = -(1 + RESTITUTION) * vn / inv;
  a.vx -= (j / ma) * nx; a.vy -= (j / ma) * ny;
  b.vx += (j / mb) * nx; b.vy += (j / mb) * ny;
  if (ev && -vn >= MIN_HIT) ev.push([HIT, -vn]);
  return true;
}

/** Advances the discs by one fixed step in place. Returns the discs pocketed in this step, in order. `ev` collects [kind, speed]. */
function step(discs, ev) {
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
      if (ev) ev.push([POCKET_FALL, speedOf(d)]);
      discs.splice(i, 1);
    }
  }
  cushions(discs, ev);
  for (let pass = 0; pass < PASSES; pass++) {
    let any = false;
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        if (collide(discs[i], discs[j], pass === 0 ? ev : null)) any = true;
      }
    }
    if (!any) break;
    cushions(discs, ev); // a push from a neighbour never puts a disc through the edge (and the bounce it causes is heard)
  }
  return pocketed;
}

const snapshot = (discs) => discs.map((d) => [d.id, round(d.x), round(d.y)]);

/** Impacts of one kind that fall within HIT_MERGE of each other become one (the loudest); capped so a shot stays small. */
function mergeEvents(raw) {
  const out = [];
  const last = [-1, -1, -1];
  for (const [t, kind, speed] of raw) {
    const i = last[kind];
    if (i >= 0 && t - out[i][0] < HIT_MERGE) { if (speed > out[i][2]) out[i][2] = speed; continue; }
    last[kind] = out.length;
    out.push([t, kind, speed]);
  }
  return out.slice(0, MAX_EVENTS).map(([t, kind, speed]) => [round(t), kind, round2(speed)]);
}

/**
 * Runs a shot until every disc stops (or MAX_TIME passes). `discs` are copied, not changed.
 * Returns { discs (those still on the board), pocketed: [{ id, kind, colour }], keyframes: [{ t, d: [[id, x, y]] }],
 * events: [[t, kind, speed]] (HIT, CUSHION_HIT, POCKET_FALL: what the clients make a sound for), settled }.
 */
function simulate(input) {
  const discs = input.map((d) => ({ ...d }));
  const kinds = new Map(input.map((d) => [d.id, d]));
  const pocketed = [];
  const keyframes = [{ t: 0, d: snapshot(discs) }];
  const raw = [];
  const maxSteps = Math.round(MAX_TIME / DT);
  let settled = false;
  for (let k = 1; k <= maxSteps; k++) {
    const ev = [];
    for (const p of step(discs, ev)) pocketed.push({ id: p.id, kind: kinds.get(p.id).kind, colour: kinds.get(p.id).colour });
    for (const [kind, speed] of ev) raw.push([k * DT, kind, speed]);
    if (k % SAMPLE_EVERY === 0) keyframes.push({ t: round(k * DT), d: snapshot(discs) });
    if (discs.every((d) => speedOf(d) < SETTLE_SPEED)) { settled = true; keyframes.push({ t: round(k * DT), d: snapshot(discs) }); break; }
  }
  if (!settled) keyframes.push({ t: round(maxSteps * DT), d: snapshot(discs) });
  // Discs that did not stop before the time limit are left where they are.
  return { discs, pocketed, keyframes, events: mergeEvents(raw), settled };
}

module.exports = { RADIUS, MASS, POCKET_R, CORNERS, MAX_SPEED, DT, MAX_TIME, ANGLE_LIMIT, HIT, CUSHION_HIT, POCKET_FALL, flickVelocity, simulate, step };
