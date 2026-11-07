'use strict';
// Debug tokens (raw verification and reset tokens in API responses) exist only for the explicit test opt-in, and a hosted
// deployment refuses to start in any configuration that could enable them.
require('./helpers/env');
const assert = require('node:assert/strict');
const { debugTokensEnabled, assertSafeDebugConfig } = require('../lib/debugTokens');
const { start } = require('../server');

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
const quiet = { log() {}, warn() {}, error() {} };

(async () => {
  console.log('debug token gate');

  await test('enabled only with NODE_ENV=test and the explicit opt-in on a non-hosted machine', () => {
    assert.equal(debugTokensEnabled({ NODE_ENV: 'test', TABLEVERSE_ALLOW_DEBUG_TOKENS: '1' }), true);
  });

  await test('test mode without the explicit opt-in never returns debug tokens', () => {
    assert.equal(debugTokensEnabled({ NODE_ENV: 'test' }), false);
    assert.equal(debugTokensEnabled({ NODE_ENV: 'test', TABLEVERSE_ALLOW_DEBUG_TOKENS: 'true' }), false, 'only the exact value 1 counts');
  });

  await test('production never returns debug tokens, even with the opt-in flag', () => {
    assert.equal(debugTokensEnabled({ NODE_ENV: 'production', TABLEVERSE_ALLOW_DEBUG_TOKENS: '1' }), false);
  });

  await test('a hosted deployment (RENDER set) never returns debug tokens, even in test mode with the flag', () => {
    assert.equal(debugTokensEnabled({ NODE_ENV: 'test', TABLEVERSE_ALLOW_DEBUG_TOKENS: '1', RENDER: 'true' }), false);
  });

  await test('unset or development NODE_ENV never returns debug tokens', () => {
    assert.equal(debugTokensEnabled({}), false);
    assert.equal(debugTokensEnabled({ NODE_ENV: 'development', TABLEVERSE_ALLOW_DEBUG_TOKENS: '1' }), false);
  });

  await test('a normal production or local configuration passes the startup check', () => {
    assert.doesNotThrow(() => assertSafeDebugConfig({ NODE_ENV: 'production', RENDER: 'true' }));
    assert.doesNotThrow(() => assertSafeDebugConfig({ NODE_ENV: 'test', TABLEVERSE_ALLOW_DEBUG_TOKENS: '1' }));
    assert.doesNotThrow(() => assertSafeDebugConfig({ NODE_ENV: 'development' }));
  });

  await test('the startup check refuses test mode on a hosted deployment', () => {
    assert.throws(() => assertSafeDebugConfig({ NODE_ENV: 'test', RENDER: 'true' }), /refused on a hosted deployment/);
  });

  await test('a leftover debug flag on a production host does not stop startup, and debug tokens stay off', () => {
    assert.doesNotThrow(() => assertSafeDebugConfig({ NODE_ENV: 'production', RENDER: 'true', TABLEVERSE_ALLOW_DEBUG_TOKENS: '1' }));
    assert.equal(debugTokensEnabled({ NODE_ENV: 'production', RENDER: 'true', TABLEVERSE_ALLOW_DEBUG_TOKENS: '1' }), false);
  });

  await test('the startup check refuses a hosted deployment that is not in production mode', () => {
    assert.throws(() => assertSafeDebugConfig({ RENDER: 'true' }), /must run with NODE_ENV=production/);
    assert.throws(() => assertSafeDebugConfig({ NODE_ENV: 'development', RENDER: 'true' }), /must run with NODE_ENV=production/);
  });

  await test('the server refuses to start in an unsafe configuration instead of listening', async () => {
    await assert.rejects(
      async () => start({ port: 0, log: quiet, matchLog: quiet, env: { NODE_ENV: 'test', RENDER: 'true', TABLEVERSE_ALLOW_DEBUG_TOKENS: '1' } }),
      /refused on a hosted deployment/
    );
  });

  console.log(`${passed} debug token checks passed`);
})().catch((e) => { console.error('FAIL debug-tokens', e); process.exit(1); });
