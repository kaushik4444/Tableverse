'use strict';
// Exercise the client's session/level boundaries without a server or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function client() {
  const values = new Map();
  const c = vm.createContext({
    S: { guest: true, username: 'alice', pending: [], routed: true },
    sessionGen: 0, httpBusy: false,
    levelRequest: 0, latestProgress: null, // the shared progress counter and the last applied progress live at app scope, so the sandbox needs its own
    store: { get: (key) => values.get(key) ?? null, set: (key, value) => values.set(key, value) },
    location: { hash: '' },
    getJson: async () => ({ stats: { progress: { account: { level: 3, into: 10, need: 140 } } } }),
    hashCode: () => '', policyRequiresVerification: () => false,
  });
  for (const name of ['render', 'hideBusy', 'closeModal', 'loadBanners', 'loadStaffHint', 'noteTurnStatus', 'scheduleIceRefresh', 'loadRecent', 'loadSocial', 'closeOverlay', 'beginSignIn', 'connect']) c[name] = () => {};
  for (const name of ['adoptPlayer', 'finishSignIn', 'clearClientSession', 'setAccount', 'noteLevelUp', 'applyProgress', 'pageProgressKey', 'refreshLevel', 'loadProfile', 'onMessage']) {
    const match = source.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  }', 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], c);
  }
  const ack = source.slice(source.indexOf('    levelUpAck: () =>'), source.indexOf('    openFriendsPage:', source.indexOf('    levelUpAck: () =>')));
  c.ack = vm.runInContext('({' + ack + '}).levelUpAck', c);
  return { c, values };
}
const settle = () => new Promise(setImmediate);

test('sign-in detects a level after welcome confirms the guest transition', async () => {
  for (const seen of [null, '2']) {
    const { c, values } = client();
    if (seen !== null) values.set('ct_level_seen_alice', seen);
    // Hydration may finish its profile request while the snapshot still says guest.
    await c.refreshLevel();
    assert.equal(c.S.levelUp, undefined);
    c.finishSignIn({ player: { username: 'alice', display_name: 'Alice', email_verified: true } });
    let renders = 0;
    c.render = () => { renders++; };
    c.onMessage({ t: 'welcome', id: 'alice' });
    const welcomeRenders = renders;
    await settle();
    assert.equal(c.S.guest, false);
    if (seen === null) {
      assert.equal(values.get('ct_level_seen_alice'), '3');
      assert.equal(c.S.levelUp, null);
    } else {
      assert.ok(renders > welcomeRenders, 'the new notice redraws even when progress was already fetched');
      assert.equal(c.S.levelUp.username, 'alice');
      assert.equal(c.S.levelUp.to, 3);
      c.ack();
      assert.equal(values.get('ct_level_seen_alice'), '3');
      assert.equal(c.S.levelUp, null);
    }
  }
});

test('clearing a session discards its notice and ignores its pending profile response', async () => {
  const { c, values } = client();
  c.S.guest = false;
  values.set('ct_level_seen_alice', '2');
  await c.refreshLevel();
  assert.ok(c.S.levelUp);
  let resolve;
  c.getJson = () => new Promise((done) => { resolve = done; });
  const pending = c.refreshLevel();
  c.clearClientSession();
  assert.equal(c.S.levelUp, null);
  c.S.username = 'bob';
  resolve({ stats: { progress: { account: { level: 9 } } } });
  await pending;
  assert.equal(c.S.account, null);
  assert.equal(c.S.levelUp, null);
});

test('a notice cannot acknowledge a level under another account and baseline clears it', async () => {
  const { c, values } = client();
  c.S.guest = false;
  values.set('ct_level_seen_alice', '2');
  await c.refreshLevel();
  const notice = c.S.levelUp;
  c.S.username = 'bob';
  c.ack();
  assert.equal(values.has('ct_level_seen_bob'), false);
  assert.equal(values.get('ct_level_seen_alice'), '2');
  c.S.levelUp = notice;
  c.noteLevelUp();
  assert.equal(values.get('ct_level_seen_bob'), '3');
  assert.equal(c.S.levelUp, null);
});

test('opening the profile detects a new level too, not only the header refresh', async () => {
  const { c, values } = client();
  c.S.guest = false;
  values.set('ct_level_seen_alice', '2');
  c.getJson = async (url) => (url.includes('/api/me/history') ? {} : { profile: { displayName: 'Alice' }, stats: { progress: { account: { level: 3, into: 10, need: 140 } } } });
  await c.loadProfile();
  assert.ok(c.S.levelUp, 'a level reached in the profile is announced');
  assert.equal(c.S.levelUp.to, 3);
});

test('an older header refresh cannot replace progress a newer profile load already applied', async () => {
  const { c } = client();
  c.S.guest = false;
  const pending = [];
  c.getJson = (url) => new Promise((resolve) => pending.push({ url, resolve }));
  const refresh = c.refreshLevel();   // older request: answers level 2
  const load = c.loadProfile();      // newer request: answers level 5
  pending[1].resolve({ profile: { displayName: 'Alice' }, stats: { progress: { account: { level: 5, into: 0, need: 200 } } } });
  pending[2].resolve({});
  await load;
  pending[0].resolve({ stats: { progress: { account: { level: 2, into: 0, need: 90 } } } });
  await refresh;
  assert.equal(c.S.account.level, 5, 'the older answer does not move the level back');
});

test('a Game XP change alone redraws the open profile', async () => {
  const { c } = client();
  c.S.guest = false;
  let renders = 0; c.render = () => { renders++; };
  c.S.profile = { loading: false, data: { stats: { progress: { account: { level: 3, into: 10, need: 140 }, games: { ludo: { points: 0, played: 0 } } } } } };
  c.getJson = async () => ({ stats: { progress: { account: { level: 3, into: 10, need: 140 }, games: { ludo: { points: 20, played: 1 } } } } });
  const before = renders;
  await c.refreshLevel();
  assert.ok(renders > before, 'the profile redraws when its Game XP changes, even if the level is the same');
});
