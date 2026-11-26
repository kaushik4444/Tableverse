'use strict';
/**
 * Runs the unit-test chain from package.json ("test") one file at a time, in order, and stops at the first failure, as
 * `a && b && c` does. The difference: each file is announced before it starts and timed, and a file that runs longer than
 * TEST_TIMEOUT_MS is stopped and named. A silent stall in CI then shows which file it was, instead of a cancelled job with
 * no output.
 *
 * Usage: node scripts/run-tests.js [chain]   (default: the "test" script in package.json)
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS ?? 300000);
if (!Number.isInteger(TIMEOUT_MS) || TIMEOUT_MS < 1 || TIMEOUT_MS > 2147483647) {
  console.error('run-tests: configuration error: TEST_TIMEOUT_MS must be an integer from 1 through 2147483647');
  process.exit(2);
}
const script = process.argv[2] || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.test;

const steps = script.split(' && ').map((s) => s.trim()).filter(Boolean);
for (const step of steps) {
  if (!/^node \S+/.test(step)) { console.error(`run-tests: only "node <file>" steps are supported, got: ${step}`); process.exit(2); }
}

function run(step) {
  return new Promise((resolve) => {
    const args = step.replace(/^node /, '').split(/\s+/);
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 'timeout' : code, signal, ms: Date.now() - started });
    });
  });
}

(async () => {
  for (const step of steps) {
    const file = step.replace(/^node /, '').split(/\s+/)[0];
    console.log(`\n=== RUN ${file}`);
    const r = await run(step);
    const secs = (r.ms / 1000).toFixed(1);
    if (r.code === 0) { console.log(`=== OK  ${file} (${secs}s)`); continue; }
    if (r.code === 'timeout') console.error(`=== TIMEOUT ${file}: still running after ${TIMEOUT_MS / 1000}s and was stopped`);
    else console.error(`=== FAIL ${file} (exit ${r.code === null ? r.signal : r.code}, ${secs}s)`);
    process.exit(1);
  }
  console.log(`\n=== all ${steps.length} test files passed`);
})();
