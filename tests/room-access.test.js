'use strict';
// The private-table access rule (lib/roomAccess.js) through the whole life of a table, without a server or a database.
// invitedBy / areFriends are stand-ins for the two database lookups; their SQL is covered by tests/private-tables.pg.test.js.
const assert = require('node:assert/strict');
const { decideAccess, hostIds } = require('../lib/roomAccess');

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }

/** A world of friendships and accepted invitations, like the database: removing a friendship revokes the invitations between the two. */
function world() {
  const friends = new Set(); const invites = []; // { inviter, invitee }
  const key = (a, b) => [a, b].sort().join('|');
  const w = {
    befriend: (a, b) => friends.add(key(a, b)),
    invite: (inviter, invitee) => invites.push({ inviter, invitee }),
    unfriend: (a, b) => { friends.delete(key(a, b)); for (let i = invites.length - 1; i >= 0; i--) if (key(invites[i].inviter, invites[i].invitee) === key(a, b)) invites.splice(i, 1); },
    areFriends: async (a, b) => friends.has(key(a, b)),
    invitedFor: (guest) => async (inviterIds) => invites.some((i) => i.invitee === guest && inviterIds.includes(i.inviter) && friends.has(key(i.inviter, i.invitee))),
    asked: [],
  };
  w.decide = (room, playerId, o = {}) => decideAccess({ room, playerId, hasDatabase: true, areFriends: w.areFriends, invitedBy: async (ids) => { w.asked.push(ids); return w.invitedFor(playerId)(ids); }, ...o });
  return w;
}
const room = (o = {}) => ({ visibility: 'private', status: 'lobby', hostId: 'A', hosts: new Set(['A']), members: [{ id: 'A' }], spectators: [], ...o });
const seat = (r, id, extra = {}) => r.members.push({ id, bot: false, ...extra });

(async () => {
  await test('public tables are open; the current host is always in', async () => {
    const w = world();
    assert.equal((await w.decide(room({ visibility: 'public' }), 'Z')).allowed, true);
    assert.deepEqual(await w.decide(room(), 'A'), { allowed: true, rule: 'host' });
  });

  await test('a stranger, and a friend who was never invited, are refused; an invited friend is let in', async () => {
    const w = world(); const r = room();
    assert.equal((await w.decide(r, 'B')).allowed, false);
    w.befriend('A', 'B'); assert.equal((await w.decide(r, 'B')).allowed, false, 'friendship alone is not an invitation');
    w.invite('A', 'B'); assert.deepEqual(await w.decide(r, 'B'), { allowed: true, rule: 'invitation' });
  });

  await test('lobby, the current host removes the friend: access ends (and reconnecting does not bring it back)', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B'); seat(r, 'B');
    assert.equal((await w.decide(r, 'B')).allowed, true);
    w.unfriend('A', 'B');
    assert.deepEqual(await w.decide(r, 'B'), { allowed: false, rule: 'no-invitation' });
  });

  await test('the guest removes the host instead: the same', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B'); seat(r, 'B');
    w.unfriend('B', 'A');
    assert.equal((await w.decide(r, 'B')).allowed, false);
  });

  await test('after a host change an invitation from the PREVIOUS host still works, and the previous host is asked about too', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.befriend('A', 'C'); w.invite('A', 'B'); w.invite('A', 'C'); seat(r, 'B'); seat(r, 'C');
    r.hostId = 'B'; r.hosts.add('B'); r.members = r.members.filter((m) => m.id !== 'A'); // A left, B hosts
    assert.deepEqual(await w.decide(r, 'C'), { allowed: true, rule: 'invitation' });
    assert.deepEqual(w.asked.at(-1).sort(), ['A', 'B'], 'both hosts are considered');
  });

  await test('previous host removes a guest after the handover: the guest loses access, the new host keeps the table', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.befriend('A', 'C'); w.invite('A', 'B'); w.invite('A', 'C'); seat(r, 'B'); seat(r, 'C');
    r.hostId = 'B'; r.hosts.add('B'); r.members = r.members.filter((m) => m.id !== 'A');
    w.unfriend('A', 'C');
    assert.equal((await w.decide(r, 'C')).allowed, false, 'C was in on A’s invitation, which is gone');
    assert.equal((await w.decide(r, 'B')).allowed, true, 'B is the host now');
  });

  await test('a guest stays if ANOTHER host still vouches for them', async () => {
    const w = world(); const r = room(); w.befriend('A', 'C'); w.befriend('B', 'C'); w.invite('A', 'C'); w.invite('B', 'C'); seat(r, 'C');
    r.hostId = 'B'; r.hosts.add('B');
    w.unfriend('A', 'C');
    assert.deepEqual(await w.decide(r, 'C'), { allowed: true, rule: 'invitation' });
  });

  await test('the previous host can come back only while the current host is still their friend', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B'); seat(r, 'B');
    r.hostId = 'B'; r.hosts.add('B'); r.members = r.members.filter((m) => m.id !== 'A');
    assert.deepEqual(await w.decide(r, 'A'), { allowed: true, rule: 'previous-host' });
    w.unfriend('B', 'A');
    assert.deepEqual(await w.decide(r, 'A'), { allowed: false, rule: 'previous-host-unfriended' });
  });

  await test('running game: a seated player keeps the seat (and may reconnect) after the friendship ends; a spectator does not', async () => {
    const w = world(); const r = room({ status: 'playing' }); w.befriend('A', 'B'); w.befriend('A', 'S'); w.invite('A', 'B'); w.invite('A', 'S'); seat(r, 'B'); r.spectators.push({ id: 'S' });
    w.unfriend('A', 'B'); w.unfriend('A', 'S');
    assert.deepEqual(await w.decide(r, 'B'), { allowed: true, rule: 'seat-in-game' });
    assert.deepEqual(await w.decide(r, 'S'), { allowed: false, rule: 'no-invitation' });
  });

  await test('running game: a player who left (a bot has the seat) cannot come back once the friendship ended', async () => {
    const w = world(); const r = room({ status: 'playing' }); w.befriend('A', 'B'); w.invite('A', 'B'); seat(r, 'B', { bot: true });
    assert.equal((await w.decide(r, 'B')).allowed, true, 'still invited: may take the seat back');
    w.unfriend('A', 'B');
    assert.equal((await w.decide(r, 'B')).allowed, false);
  });

  await test('finished game keeps the seat until the rematch; after the rematch (lobby) it is checked again', async () => {
    const w = world(); const r = room({ status: 'finished' }); w.befriend('A', 'B'); w.invite('A', 'B'); seat(r, 'B');
    w.unfriend('A', 'B');
    assert.equal((await w.decide(r, 'B')).allowed, true, 'results screen still theirs');
    r.status = 'lobby';
    assert.equal((await w.decide(r, 'B')).allowed, false, 'the rematch lobby is a new gathering');
  });

  await test('after removal a new invitation cannot exist: the invitation lookup stays false until they are friends and invited again', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B'); w.unfriend('A', 'B');
    assert.equal((await w.decide(r, 'B')).allowed, false);
    w.invite('A', 'B'); // an invitation row without a friendship (cannot be created by the API) still grants nothing
    assert.equal((await w.decide(r, 'B')).allowed, false);
    w.befriend('A', 'B'); w.invite('A', 'B');
    assert.equal((await w.decide(r, 'B')).allowed, true);
  });

  await test('without a database, or for an anonymous player, only the host gets into a private table', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B');
    assert.deepEqual(await w.decide(r, 'B', { hasDatabase: false }), { allowed: false, rule: 'no-friends' });
    assert.deepEqual(await w.decide(r, 'B', { isAnonymous: true }), { allowed: false, rule: 'no-friends' });
    assert.equal((await w.decide(r, 'A', { hasDatabase: false })).allowed, true);
  });

  await test('hostIds lists the current host first, once each, ignoring empties', async () => {
    assert.deepEqual(hostIds({ hostId: 'B', hosts: new Set(['A', 'B']) }), ['B', 'A']);
    assert.deepEqual(hostIds({ hostId: 'A' }), ['A']);
  });

  console.log(`\n${passed} room access tests passed`);
})();
