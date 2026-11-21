'use strict';
/**
 * Ready-up before a round starts. The table waits (no bot moves, no timers, no moves from people) until every seated person
 * who is here has pressed Ready. Bots are always ready, and so is a person who is away (a bot stands in for them), so the table
 * never waits for someone who cannot press.
 *
 * It is used for the first round (the gate opens when the game starts) and for every round boundary: a state where the game
 * is waiting only for its "continue" action (room.gatePassed keeps one boundary to one gate).
 *
 * room.gate is null when no one is being waited for, or a Set of the person ids who pressed Ready.
 */
function startGate(room) {
  room.gate = new Set();
  room.gatePassed = false;
}

/** Everybody seated, human and connected, has pressed Ready (bots and people who are away count as ready). */
function gateOpen(room, isConnected) {
  if (!room.gate) return true;
  return room.members.every((m) => m.bot || room.gate.has(m.id) || !isConnected(m));
}

/** A seated person presses Ready. Returns true when the gate is waiting for them and they were counted. */
function markReady(room, id) {
  if (!room.gate) return false;
  const seated = room.members.some((m) => m.id === id && !m.bot);
  if (!seated) return false;
  room.gate.add(id);
  return true;
}

/** What the table shows: who has pressed Ready and who is still expected to. Null when the table is not waiting. */
function readyState(room, isConnected) {
  if (!room.gate) return null;
  const waiting = room.members.filter((m) => !m.bot && !room.gate.has(m.id) && isConnected(m)).map((m) => m.id);
  return { ready: [...room.gate], waiting };
}

module.exports = { startGate, gateOpen, markReady, readyState };
