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
    sessionGen: 0, httpBusy: false, reqVeilOwned: false, // the loading veil's ownership flag, read by onMessage
    reqPending: new Set(), reqVeilTimer: null, clearTimeout: () => {}, // cleared by clearClientSession with the veil flag
    levelRequest: 0, // the newest refresh counter lives at app scope (`let levelRequest` next to refreshLevel), so the sandbox needs its own
    store: { get: (key) => values.get(key) ?? null, set: (key, value) => values.set(key, value) },
    location: { hash: '' },
    getJson: async () => ({ stats: { progress: { account: { level: 3, into: 10, need: 140 } } } }),
    hashCode: () => '', policyRequiresVerification: () => false,
  });
  for (const name of ['render', 'hideBusy', 'closeModal', 'loadBanners', 'loadStaffHint', 'noteTurnStatus', 'scheduleIceRefresh', 'loadRecent', 'loadSocial', 'closeOverlay', 'beginSignIn', 'connect']) c[name] = () => {};
  for (const name of ['adoptPlayer', 'finishSignIn', 'clearClientSession', 'setAccount', 'noteLevelUp', 'refreshLevel', 'loadProfile', 'applyLegal', 'onMessage']) {
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

// A profile load also waits for history; a refresh may start or finish in that gap.
for (const seedCache of ['refreshLevel', 'loadProfile']) {
  for (const newerState of ['pending', 'failed', 'succeeded']) {
    test(`profile reuses only newer cached progress (${seedCache} cache, refresh ${newerState})`, async () => {
      const { c, values } = client();
      c.S.guest = false;
      values.set('ct_level_seen_alice', '1');
      const response = (level) => ({ profile: { displayName: 'Alice' }, stats: { progress: { account: { level } } } });
      c.getJson = async () => response(1);
      await c[seedCache]();
      assert.equal(c.S.latestProgressRequest, 1);
      const pending = [];
      c.getJson = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
      const profile = c.loadProfile();
      const refresh = c.refreshLevel();
      if (newerState === 'failed') pending[2].reject(new Error('offline'));
      if (newerState === 'succeeded') pending[2].resolve(response(3));
      if (newerState !== 'pending') await refresh;
      pending[0].resolve(response(2));
      pending[1].resolve({});
      await profile;
      assert.equal(c.S.profile.data.stats.progress.account.level, newerState === 'succeeded' ? 3 : 2);
      if (newerState === 'failed') {
        assert.equal(c.S.account.level, 2, 'the successful profile response still updates the account after a newer refresh fails');
        assert.equal(c.S.levelUp.to, 2, 'the accepted profile response triggers the level-up notice');
      }
      if (newerState === 'pending') {
        pending[2].resolve(response(3));
        await refresh;
        assert.equal(c.S.profile.data.stats.progress.account.level, 3);
      }
      assert.equal(c.S.latestProgressRequest, newerState === 'failed' ? 2 : 3);
      c.clearClientSession();
      assert.equal(c.S.latestProgressRequest, 0);
    });
  }
}

test('the level-up dialog waits for a menu visit, shows once, and counts as seen when it opens', () => {
  const opened = [];
  const values = new Map();
  const c = vm.createContext({
    S: { username: 'alice', guest: false, room: null, page: 'player', levelUp: { username: 'alice', from: 2, to: 3 }, account: { level: 3, into: 10, need: 140 } },
    store: { get: (k) => values.get(k) ?? null, set: (k, v) => values.set(k, v) },
    document: { getElementById: () => null },
    openModal: (title, body) => opened.push({ title, body }),
  });
  const match = source.match(/^  function showLevelUpDialog\([^]*?^  }/m);
  assert.ok(match, 'showLevelUpDialog');
  vm.runInContext(match[0], c);
  c.showLevelUpDialog(); // not on the menu yet: the notice waits
  assert.equal(opened.length, 0);
  assert.ok(c.S.levelUp, 'still pending');
  c.S.page = 'home';
  c.S.username = 'bob'; c.showLevelUpDialog(); // another account's notice never shows here
  assert.equal(opened.length, 0);
  c.S.username = 'alice'; c.showLevelUpDialog();
  assert.equal(opened.length, 1);
  assert.match(opened[0].body, /reaching level 3/);
  assert.match(opened[0].body, /Next level in 130 min of play/);
  assert.equal(values.get('ct_level_seen_alice'), '3', 'seen as soon as it opens');
  assert.equal(c.S.levelUp, null);
  c.showLevelUpDialog();
  assert.equal(opened.length, 1, 'not shown again');
});
