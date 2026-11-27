'use strict';
// Google ID token verification with a locally generated key pair: no network.
require('./helpers/env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createVerifier, nonceFor, GoogleAuthError, cspFor } = require('../lib/googleAuth');

let passed = 0; let failed = 0;
// DIAGNOSTIC (temporary, to be reverted): if this file makes no progress for 60 seconds, print what keeps the process alive
let lastProgress = Date.now(); let current = '(none)';
const diag = setInterval(() => {
  if (Date.now() - lastProgress < 60000) return;
  console.log('DIAG stalled in: ' + current + ' | resources: ' + JSON.stringify(process.getActiveResourcesInfo()));
  for (const h of process._getActiveHandles()) console.log('DIAG handle: ' + h.constructor.name + (h.remoteAddress ? ' ' + h.remoteAddress : '') + (h._idleTimeout !== undefined ? ' timeout=' + h._idleTimeout : ''));
  process.exit(3);
}, 5000);
diag.unref();
async function test(name, fn) { current = name; lastProgress = Date.now(); try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } lastProgress = Date.now(); }

const CLIENT = 'client-123.apps.googleusercontent.com';
const NOW = 1800000000000;
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = (kp, kid) => ({ ...kp.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(over = {}, { key = pair.privateKey, header = {} } = {}) {
  const t = Math.floor(NOW / 1000);
  const claims = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234567890', email: 'Player@Example.com', email_verified: true, name: 'Pat Player', nonce: 'n1', iat: t, exp: t + 3600, ...over };
  const head = { alg: 'RS256', kid: 'k1', typ: 'JWT', ...header };
  const signed = b64(head) + '.' + b64(claims);
  return signed + '.' + crypto.sign('RSA-SHA256', Buffer.from(signed), key).toString('base64url');
}
let fetches = 0;
const mk = (over = {}) => createVerifier({ clientId: CLIENT, now: () => NOW, fetchJwks: async () => { fetches++; return { keys: [jwk(pair, 'k1')] }; }, ...over });
const rejects = async (p, detail) => { try { await p; } catch (e) { assert.ok(e instanceof GoogleAuthError, 'a GoogleAuthError, got ' + e); if (detail) assert.match(e.detail, detail); return; } assert.fail('expected a rejection'); };

(async () => {
  await test('a valid token gives the verified identity, with the email lower-cased', async () => {
    const c = await mk().verify(token(), { nonce: 'n1' });
    assert.deepEqual(c, { sub: '1234567890', email: 'player@example.com', name: 'Pat Player' });
  });
  await test('a bad signature (another key) is rejected', async () => rejects(mk().verify(token({}, { key: other.privateKey }), { nonce: 'n1' }), /signature/));
  await test('a tampered payload is rejected', async () => {
    const [h, , s] = token().split('.');
    const forged = b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'someone-else', email: 'x@y.z', email_verified: true, nonce: 'n1', exp: NOW / 1000 + 3600 });
    await rejects(mk().verify(h + '.' + forged + '.' + s, { nonce: 'n1' }), /signature/);
  });
  await test('alg none and HS256 are rejected', async () => {
    await rejects(mk().verify(token({}, { header: { alg: 'none' } }), { nonce: 'n1' }), /alg/);
    await rejects(mk().verify(token({}, { header: { alg: 'HS256' } }), { nonce: 'n1' }), /alg/);
    await rejects(mk().verify(b64({ alg: 'none' }) + '.' + b64({ sub: 'x' }) + '.', { nonce: 'n1' }));
  });
  await test('the wrong audience, issuer, nonce or an expired token is rejected', async () => {
    await rejects(mk().verify(token({ aud: 'someone-elses-app' }), { nonce: 'n1' }), /audience/);
    await rejects(mk().verify(token({ iss: 'https://evil.example' }), { nonce: 'n1' }), /issuer/);
    await rejects(mk().verify(token(), { nonce: 'other' }), /nonce/);
    await rejects(mk().verify(token(), {}), /nonce/);
    await rejects(mk().verify(token({ nonce: undefined }), { nonce: 'n1' }), /nonce/);
    await rejects(mk().verify(token({ exp: NOW / 1000 - 3600 }), { nonce: 'n1' }), /expired/);
    await rejects(mk().verify(token({ iat: NOW / 1000 + 3600 }), { nonce: 'n1' }), /iat/);
  });
  await test('a deletion confirmation must be a recent token: an older one is refused even if otherwise valid', async () => {
    const t = Math.floor(NOW / 1000);
    await mk().verify(token({ iat: t, exp: t + 3600 }), { nonce: 'n1', maxAgeSeconds: 300 });
    await rejects(mk().verify(token({ iat: t - 3600, exp: t + 3000 }), { nonce: 'n1', maxAgeSeconds: 300 }), /too old/);
    await mk().verify(token({ iat: t - 3600, exp: t + 3000 }), { nonce: 'n1' }); // without a limit an older token is still a valid sign-in
  });
  await test('an unverified or missing email is rejected', async () => {
    await rejects(mk().verify(token({ email_verified: false }), { nonce: 'n1' }), /not verified/);
    await rejects(mk().verify(token({ email_verified: 'true' }), { nonce: 'n1' }), /not verified/);
    await rejects(mk().verify(token({ email: undefined }), { nonce: 'n1' }), /no email/);
  });
  await test('no client id means sign-in is off; junk and oversized tokens are rejected before any key is used', async () => {
    await rejects(createVerifier({ clientId: '' }).verify(token(), { nonce: 'n1' }), /client id/);
    const v = mk(); const before = fetches;
    await rejects(v.verify('not a jwt', { nonce: 'n1' })); await rejects(v.verify('a.b', { nonce: 'n1' })); await rejects(v.verify('x'.repeat(5000), { nonce: 'n1' })); await rejects(v.verify(null, {}));
    assert.equal(fetches, before, 'no key fetch for malformed input');
  });
  await test('keys are cached; an unknown key id refetches at most once per minute', async () => {
    fetches = 0; let t = NOW; const v = mk({ now: () => t });
    await v.verify(token(), { nonce: 'n1' }); await v.verify(token(), { nonce: 'n1' });
    assert.equal(fetches, 1, 'cached');
    t += 61000;
    await rejects(v.verify(token({}, { header: { kid: 'rotated' } }), { nonce: 'n1' }), /unknown kid/);
    await rejects(v.verify(token({}, { header: { kid: 'rotated' } }), { nonce: 'n1' }), /unknown kid/);
    assert.equal(fetches, 2, 'one refetch for the unknown kid, not one per attempt');
  });
  await test('a key outage is reported as unavailable, retried only after a pause, and a later success recovers', async () => {
    let up = false; let calls = 0; let t = NOW;
    const v = createVerifier({ clientId: CLIENT, now: () => t, fetchJwks: async () => { calls++; if (!up) throw new Error('down'); return { keys: [jwk(pair, 'k1')] }; } });
    await rejects(v.verify(token(), { nonce: 'n1' }), /jwks/);
    await rejects(v.verify(token(), { nonce: 'n1' }), /keys unavailable/);
    assert.equal(calls, 1, 'no second fetch right after a failure');
    up = true; t += 11000;
    assert.equal((await v.verify(token(), { nonce: 'n1' })).sub, '1234567890');
    assert.equal(calls, 2);
  });
  await test('with cached keys, an outage at expiry does not fetch on every sign-in, and one request never fetches twice', async () => {
    let up = true; let calls = 0; let t = NOW;
    const v = createVerifier({ clientId: CLIENT, now: () => t, fetchJwks: async () => { calls++; if (!up) throw new Error('down'); return { keys: [jwk(pair, 'k1')] }; } });
    await v.verify(token(), { nonce: 'n1' });
    assert.equal(calls, 1);
    up = false; t += 3700000; // the cache has expired; Google is down
    const late = () => token({ exp: Math.floor(t / 1000) + 3600, iat: Math.floor(t / 1000) });
    for (let i = 0; i < 5; i++) assert.equal((await v.verify(late(), { nonce: 'n1' })).sub, '1234567890', 'the cached key still verifies');
    assert.equal(calls, 2, 'one failed refresh, then the pause holds: ' + calls);
    // an expired cache and an unknown key id in one request: still one fetch
    t += 11000;
    await rejects(v.verify(token({ exp: Math.floor(t / 1000) + 3600, iat: Math.floor(t / 1000) }, { header: { kid: 'rotated' } }), { nonce: 'n1' }), /unknown kid/);
    assert.equal(calls, 3, 'one fetch for that request');
  });
  await test('a connection that fails while the key body is being read rejects instead of crashing', async () => {
    const { EventEmitter } = require('node:events');
    const https = require('node:https'); const orig = https.get;
    https.get = (url, opts, cb) => { const req = new EventEmitter(); req.destroy = () => {}; process.nextTick(() => { const res = new EventEmitter(); res.statusCode = 200; res.resume = () => {}; cb(res); process.nextTick(() => res.emit('error', new Error('socket hang up'))); }); return req; };
    try {
      delete require.cache[require.resolve('../lib/googleAuth')];
      const fresh = require('../lib/googleAuth');
      const v = fresh.createVerifier({ clientId: CLIENT, now: () => NOW });
      let err; try { await v.verify(token(), { nonce: 'n1' }); } catch (e) { err = e; }
      assert.ok(err && err.name === 'GoogleAuthError' && /jwks: socket hang up/.test(err.detail), 'a safe error, not a crash: ' + err);
    } finally { https.get = orig; delete require.cache[require.resolve('../lib/googleAuth')]; }
  });
  await test('concurrent sign-ins share one key fetch: none fails because another is already fetching', async () => {
    let calls = 0; let release; const gate = new Promise((r) => { release = r; });
    const v = createVerifier({ clientId: CLIENT, now: () => NOW, fetchJwks: async () => { calls++; await gate; return { keys: [jwk(pair, 'k1')] }; } });
    const all = Promise.all([1, 2, 3].map(() => v.verify(token(), { nonce: 'n1' })));
    setTimeout(release, 20);
    const out = await all;
    assert.ok(out.every((c) => c.sub === '1234567890')); assert.equal(calls, 1, 'one fetch for three requests');
    // a rotated key: a request for it while a refresh is already running waits for that refresh
    let t = NOW + 61000; let rot = false; let c2 = 0; let rel2; const gate2 = new Promise((r) => { rel2 = r; });
    const v2 = createVerifier({ clientId: CLIENT, now: () => t, fetchJwks: async () => { c2++; if (c2 > 1) { await gate2; } return { keys: [jwk(pair, 'k1'), ...(c2 > 1 ? [jwk(pair, 'k2')] : [])] }; } });
    await v2.verify(token(), { nonce: 'n1' }); t += 61000;
    const fresh = () => token({ exp: Math.floor(t / 1000) + 3600, iat: Math.floor(t / 1000) }, { header: { kid: 'k2' } });
    const both = Promise.all([v2.verify(fresh(), { nonce: 'n1' }), v2.verify(fresh(), { nonce: 'n1' })]);
    setTimeout(rel2, 20);
    assert.ok((await both).every((c) => c.sub === '1234567890'), 'both get the new key'); assert.equal(c2, 2);
  });
  await test('the nonce is a hash of the CSRF value: stable for one browser, different for another', () => {
    assert.equal(nonceFor('abc'), nonceFor('abc')); assert.notEqual(nonceFor('abc'), nonceFor('abd')); assert.match(nonceFor('abc'), /^[0-9a-f]{64}$/);
  });
  await test('the CSP opens up for Google only when a client ID is configured', () => {
    const off = cspFor({});
    assert.ok(!off.includes('google'), off); assert.match(off, /default-src 'self'/); assert.match(off, /frame-ancestors 'none'/);
    const on = cspFor({ GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com' });
    assert.match(on, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/); assert.match(on, /frame-src https:\/\/accounts\.google\.com\/gsi\//);
    assert.match(on, /connect-src 'self' ws: wss: https:\/\/accounts\.google\.com\/gsi\//); assert.match(on, /object-src 'none'/);
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(on) && !/script-src[^;]*\*/.test(on), 'no inline or wildcard scripts');
    assert.ok(!cspFor({ GOOGLE_CLIENT_ID: '   ' }).includes('google'), 'blank means off');
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
