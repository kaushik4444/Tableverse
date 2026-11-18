'use strict';
// The owner's Render redeploy (lib/renderDeploy.js), with a fake fetch and clock: nothing is sent to Render from here.
const assert = require('node:assert/strict');
const { createRenderDeploy, COOLDOWN_MS } = require('../lib/renderDeploy');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const CONFIGURED = { RENDER_API_KEY: 'key-abc', RENDER_SERVICE_ID: 'srv-123' };
const reply = (status, body = '') => ({ status, ok: status >= 200 && status < 300, text: async () => body });

(async () => {
  await test('not configured: refused with 503 and nothing is sent', async () => {
    let calls = 0;
    const d = createRenderDeploy({ env: {}, fetchImpl: async () => { calls++; return reply(201); } });
    assert.equal(d.configured, false);
    const out = await d.redeploy();
    assert.equal(out.ok, false);
    assert.equal(out.status, 503);
    assert.equal(calls, 0);
  });

  await test('only one of the two settings is not enough', async () => {
    assert.equal(createRenderDeploy({ env: { RENDER_API_KEY: 'k' } }).configured, false);
    assert.equal(createRenderDeploy({ env: { RENDER_SERVICE_ID: 's' } }).configured, false);
  });

  await test('configured: POSTs an empty body to the service deploys endpoint with the key, and 201 is success', async () => {
    let seen = null;
    const d = createRenderDeploy({ env: CONFIGURED, fetchImpl: async (url, opts) => { seen = { url, opts }; return reply(201, '{"id":"dep-1"}'); } });
    const out = await d.redeploy();
    assert.deepEqual(out, { ok: true });
    assert.equal(seen.url, 'https://api.render.com/v1/services/srv-123/deploys');
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.body, '{}');
    assert.equal(seen.opts.headers.Authorization, 'Bearer key-abc');
    assert.ok(seen.opts.signal, 'a timeout is set');
  });

  await test('202 is also success', async () => {
    const d = createRenderDeploy({ env: CONFIGURED, fetchImpl: async () => reply(202) });
    assert.equal((await d.redeploy()).ok, true);
  });

  await test('a refusal gives 502 with the status only: Render\'s body is never passed on', async () => {
    const d = createRenderDeploy({ env: CONFIGURED, fetchImpl: async () => reply(401, 'secret-body-from-render') });
    const out = await d.redeploy();
    assert.equal(out.ok, false);
    assert.equal(out.status, 502);
    assert.match(out.error, /HTTP 401/);
    assert.doesNotMatch(out.error, /secret-body/);
  });

  await test('a network failure gives 502 without the error details', async () => {
    const d = createRenderDeploy({ env: CONFIGURED, fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND internal-host'); } });
    const out = await d.redeploy();
    assert.equal(out.status, 502);
    assert.doesNotMatch(out.error, /internal-host/);
  });

  await test('cooldown: a second request within five minutes is refused, and allowed after it', async () => {
    let t = 1000;
    let calls = 0;
    const d = createRenderDeploy({ env: CONFIGURED, now: () => t, fetchImpl: async () => { calls++; return reply(201); } });
    assert.equal((await d.redeploy()).ok, true);
    const again = await d.redeploy();
    assert.equal(again.status, 429);
    assert.ok(again.retryAfterMs > 0 && again.retryAfterMs <= COOLDOWN_MS);
    assert.equal(calls, 1, 'the refused request sent nothing');
    t += COOLDOWN_MS + 1;
    assert.equal((await d.redeploy()).ok, true);
    assert.equal(calls, 2);
  });

  await test('a request while another is in progress is refused (single flight)', async () => {
    let release;
    let calls = 0;
    const d = createRenderDeploy({ env: CONFIGURED, fetchImpl: () => { calls++; return new Promise((r) => { release = () => r(reply(201)); }); } });
    const first = d.redeploy();
    const second = await d.redeploy();
    assert.equal(second.status, 429);
    release();
    assert.equal((await first).ok, true);
    assert.equal(calls, 1);
  });

  console.log(`\n${passed} redeploy checks passed`);
})();
