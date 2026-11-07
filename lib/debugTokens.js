'use strict';
/**
 * Debug tokens: the API returns raw verification and reset tokens so the automated tests can finish email flows without
 * a mailbox. Anyone who can reach a deployed server could otherwise verify or reset any account, so this is allowed
 * only when the test process explicitly opts in (TABLEVERSE_ALLOW_DEBUG_TOKENS=1, set by tests/helpers/env.js) with
 * NODE_ENV=test, and never on a hosted deployment. Render sets RENDER on every service.
 */

/** A hosted deployment is Render, or any server started in production mode. */
function isHostedDeployment(env) {
  return Boolean(env.RENDER) || env.NODE_ENV === 'production';
}

function debugTokensEnabled(env) {
  return env.NODE_ENV === 'test' && env.TABLEVERSE_ALLOW_DEBUG_TOKENS === '1' && !isHostedDeployment(env);
}

/** Refuses an unsafe configuration before the server listens. Throws with a message that names the problem. */
function assertSafeDebugConfig(env) {
  if (env.RENDER && env.NODE_ENV === 'test') {
    throw new Error('NODE_ENV=test is refused on a hosted deployment (RENDER is set): it would return debug tokens to visitors.');
  }
  if (env.RENDER && env.NODE_ENV !== 'production') {
    throw new Error(`A hosted deployment (RENDER is set) must run with NODE_ENV=production; it is "${env.NODE_ENV || 'unset'}".`);
  }
}

module.exports = { debugTokensEnabled, assertSafeDebugConfig, isHostedDeployment };
