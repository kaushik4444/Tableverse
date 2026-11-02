'use strict';
// The private-table access rule (lib/roomAccess.js, written up in docs/PRIVATE_TABLES.md) without a server or a database.
// `invitedBy` stands in for db/friends.canJoinPrivateRoom; its SQL is covered by tests/private-table-access.pg.test.js.
const assert = require('node:assert/strict');
const { decideAccess, inviterIds } = require('../lib/roomAccess');

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }

/** Friendships and accepted invitations like the database: removing a friendship revokes the invitations between the two. */
function world() {
  const friends = new Set(); const invites = []; const key = (a, b) => [a, b].sort().join('|');
  const w = {
    asked: [],
    befriend: (a, b) => friends.add(key(a, b)),
    invite: (inviter, invitee, { expired = false } = {}) => invites.push({ inviter, invitee, expired }),
    unfriend: (a, b) => { friends.delete(key(a, b)); for (let i = invites.length - 1; i >= 0; i--) if (key(invites[i].inviter, invites[i].invitee) === key(a, b)) invites.splice(i, 1); },
  };
  w.decide = (room, playerId, o = {}) => decideAccess({
    room, playerId, hasDatabase: true, ...o,
    invitedBy: async (ids, opts) => { w.asked.push({ ids, opts }); return invites.some((i) => i.invitee === playerId && ids.includes(i.inviter) && friends.has(key(i.inviter, i.invitee)) && (!i.expired || opts.allowExpired)); },
  });
  return w;
}
const room = (o = {}) => ({ visibility: 'private', hostId: 'A', creatorId: 'A', hosts: new Set(['A']), admitted: new Set(), ...o });
const handover = (r, to) => { r.hostId = to; r.hosts.add(to); };

(async () => {
  await test('public tables are open; the host and the creator are always in', async () => {
    const w = world();
    assert.equal((await w.decide(room({ visibility: 'public' }), 'Z')).rule, 'public');
    assert.equal((await w.decide(room(), 'A')).rule, 'host');
    const r = room(); handover(r, 'B');
    assert.deepEqual(await w.decide(r, 'A'), { allowed: true, rule: 'host' }, 'the creator keeps access after handing over');
    assert.equal((await w.decide(r, 'B')).allowed, true);
  });

  await test('a stranger, and a friend who was never invited, are refused; an invited friend gets in', async () => {
    const w = world(); const r = room();
    assert.equal((await w.decide(r, 'B')).allowed, false);
    w.befriend('A', 'B'); assert.equal((await w.decide(r, 'B')).allowed, false, 'friendship alone is not an invitation');
    w.invite('A', 'B'); assert.deepEqual(await w.decide(r, 'B'), { allowed: true, rule: 'invitation' });
  });

  await test('the current host removes a friend: access ends, and a reconnect does not bring it back', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B');
    w.unfriend('A', 'B');
    assert.deepEqual(await w.decide(r, 'B', { present: true }), { allowed: false, rule: 'no-invitation' });
  });

  await test('the guest removes the host instead: the same', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B');
    w.unfriend('B', 'A');
    assert.equal((await w.decide(r, 'B', { present: true })).allowed, false);
  });

  await test('after a host change an invitation from the PREVIOUS host still works, and every host is asked about', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.befriend('A', 'C'); w.invite('A', 'B'); w.invite('A', 'C');
    handover(r, 'B');
    assert.deepEqual(await w.decide(r, 'C'), { allowed: true, rule: 'invitation' });
    assert.deepEqual([...w.asked.at(-1).ids].sort(), ['A', 'B']);
  });

  await test('the previous host removes a guest after the handover: the guest loses access, the new host keeps the table', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.befriend('A', 'C'); w.invite('A', 'B'); w.invite('A', 'C');
    handover(r, 'B'); w.unfriend('A', 'C');
    assert.equal((await w.decide(r, 'C', { present: true })).allowed, false);
    assert.equal((await w.decide(r, 'B', { present: true })).allowed, true);
  });

  await test('a guest stays if ANOTHER host still vouches for them', async () => {
    const w = world(); const r = room(); w.befriend('A', 'C'); w.befriend('B', 'C'); w.invite('A', 'C'); w.invite('B', 'C');
    handover(r, 'B'); w.unfriend('A', 'C');
    assert.equal((await w.decide(r, 'C', { present: true })).allowed, true);
  });

  await test('a new host who was invited keeps hosting when the old host unfriends them', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B'); handover(r, 'B'); w.unfriend('A', 'B');
    assert.equal((await w.decide(r, 'B', { present: true })).allowed, true);
  });

  await test('being seated is not a pass: a seated guest whose friendship ended is refused (server.js then lets a running game finish)', async () => {
    const w = world(); const r = room({ status: 'playing', members: [{ id: 'B' }] }); w.befriend('A', 'B'); w.invite('A', 'B'); w.unfriend('A', 'B');
    assert.equal((await w.decide(r, 'B', { present: true })).allowed, false);
  });

  await test('an expired invitation stops NEW entries but not someone already at the table', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B', { expired: true });
    assert.equal((await w.decide(r, 'B')).allowed, false, 'new entry');
    assert.equal((await w.decide(r, 'B', { present: true })).allowed, true, 'already present');
  });

  await test('a public table made private keeps the guests already there; newcomers need an invitation', async () => {
    const w = world(); const r = room({ admitted: new Set(['G']) });
    assert.deepEqual(await w.decide(r, 'G'), { allowed: true, rule: 'admitted' });
    assert.equal((await w.decide(r, 'N')).allowed, false);
  });

  await test('after removal a new invitation needs a new friendship; a stray invitation row alone grants nothing', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B'); w.unfriend('A', 'B');
    assert.equal((await w.decide(r, 'B')).allowed, false);
    w.invite('A', 'B'); assert.equal((await w.decide(r, 'B')).allowed, false);
    w.befriend('A', 'B'); w.invite('A', 'B'); assert.equal((await w.decide(r, 'B')).allowed, true);
  });

  await test('without a database, or for an anonymous player, only the host and creator get into a private table', async () => {
    const w = world(); const r = room(); w.befriend('A', 'B'); w.invite('A', 'B');
    assert.deepEqual(await w.decide(r, 'B', { hasDatabase: false }), { allowed: false, rule: 'no-friends' });
    assert.deepEqual(await w.decide(r, 'B', { isAnonymous: true }), { allowed: false, rule: 'no-friends' });
    assert.equal((await w.decide(r, 'A', { hasDatabase: false })).allowed, true);
  });

  await test('inviterIds lists creator, host and earlier hosts once each, ignoring empties', async () => {
    assert.deepEqual(inviterIds({ creatorId: 'A', hostId: 'B', hosts: new Set(['A', 'B']) }).sort(), ['A', 'B']);
    assert.deepEqual(inviterIds({ hostId: 'A' }), ['A']);
  });

  console.log(`\n${passed} room access tests passed`);
})();
