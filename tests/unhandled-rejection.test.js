'use strict';
// Regression test: an unhandledRejection must trigger a controlled shutdown (exit 1)
// rather than silently continuing in a potentially inconsistent state.
//
// This test does NOT start the full server (which requires ws/pg). Instead it spawns
// a minimal helper script that registers the same crashShutdown pattern used in
// server.js and fires a synthetic unhandledRejection, then checks the exit code.
// No external dependencies required — only Node built-ins.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const guard = setTimeout(() => {
  console.error('FAIL unhandled-rejection test timed out');
  process.exit(1);
}, 15000);

// ── inline helper script ──────────────────────────────────────────────────────
// This is the same pattern that server.js registers after start().
const helperScript = `
'use strict';
// Simulate the crashShutdown pattern from server.js (standalone section).
// A real close() would drain the match queue and close sockets; here we just
// resolve immediately to keep the test fast.
function simulatedClose({ drainMs = 0 } = {}) {
  return new Promise((r) => setTimeout(r, Math.min(drainMs, 50)));
}

let crashing = false;
const crashShutdown = (label, reason) => {
  process.stderr.write('[server] ' + label + ': ' + (reason && reason.message || String(reason)) + '\\n');
  if (crashing) return;
  crashing = true;
  simulatedClose({ drainMs: 50 }).then(() => process.exit(1), () => process.exit(1));
};

process.on('unhandledRejection', (reason) => crashShutdown('unhandled rejection', reason));
process.on('uncaughtException',  (err)    => crashShutdown('uncaught exception',  err));

// Fire an unhandledRejection: create a rejected promise with no .catch().
Promise.reject(new Error('simulated unhandled rejection'));

// Guard: if the handler never fires, exit with an error code after 5 s.
setTimeout(() => { process.stderr.write('TIMEOUT: handler never fired\\n'); process.exit(2); }, 5000).unref();
`;

// Write to a temp file so we can run it
const { writeFileSync, unlinkSync } = require('node:fs');
const helperPath = path.join(__dirname, '_rej_helper_tmp.js');
writeFileSync(helperPath, helperScript);

try {
  const result = spawnSync(process.execPath, [helperPath], {
    timeout: 10000,
    encoding: 'utf8',
  });

  if (result.error) throw result.error;

  const stderr = result.stderr || '';
  const stdout = result.stdout || '';

  assert.ok(
    stderr.includes('unhandled rejection'),
    'server must log the unhandled rejection to stderr\nstdout: ' + stdout + '\nstderr: ' + stderr
  );
  assert.equal(
    result.status, 1,
    'server must exit with code 1 after unhandledRejection (controlled shutdown)\nstdout: ' + stdout + '\nstderr: ' + stderr
  );
  assert.ok(
    !stderr.includes('TIMEOUT'),
    'crashShutdown handler must have fired before the guard timeout'
  );

  console.log('  ok  unhandledRejection triggers controlled shutdown (exit 1, rejection logged)');
} catch (e) {
  console.error('FAIL', e.message || e.stack);
  process.exitCode = 1;
} finally {
  try { unlinkSync(helperPath); } catch { /* ignore */ }
}

clearTimeout(guard);
process.exit(process.exitCode || 0);
