'use strict';
// Static checks on .github/workflows/cleanup-unverified.yml: the dry run can never reach the deletion secret, environment
// or statement, and deletion is reachable only through the approval-gated job. No YAML parser is needed: the file is
// checked as text, job by job.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'cleanup-unverified.yml'), 'utf8');

// Split the jobs section into { name -> body }.
function jobs() {
  const at = text.indexOf('\njobs:\n');
  assert.ok(at > 0, 'the workflow has a jobs section');
  const body = text.slice(at + '\njobs:\n'.length).split('\n');
  const out = {};
  let current = null;
  for (const line of body) {
    const m = /^  ([a-z][a-z-]*):\s*$/.exec(line);
    if (m) { current = m[1]; out[current] = []; continue; }
    if (current) out[current].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
}
const J = jobs();

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

check('two jobs: a dry run and a deletion job', () => {
  assert.deepEqual(Object.keys(J).sort(), ['cleanup-delete', 'cleanup-dry-run']);
});

check('the dry run has no environment, reads only the read-only secret, and never mentions the deletion secret or variable', () => {
  const dry = J['cleanup-dry-run'];
  assert.doesNotMatch(dry, /^\s+environment:/m, 'no environment: its secrets must not be gated');
  assert.match(dry, /DATABASE_URL: \$\{\{ secrets\.CLEANUP_DRYRUN_DATABASE_URL \}\}/);
  assert.doesNotMatch(dry, /CLEANUP_DATABASE_URL\b/, 'the deletion secret is not referenced');
  assert.doesNotMatch(dry, /CLEANUP_EXECUTE/, 'the deletion variable is not referenced');
  assert.doesNotMatch(dry, /--execute/, 'the dry run never passes --execute');
});

check('the dry run does not depend on inputs.execute or the schedule', () => {
  assert.doesNotMatch(J['cleanup-dry-run'], /^\s+if:\s.*inputs\.execute/m);
});

check('the deletion job is in the production-cleanup environment and uses the deletion secret', () => {
  const del = J['cleanup-delete'];
  assert.match(del, /^\s+environment: production-cleanup\s*$/m);
  assert.match(del, /DATABASE_URL: \$\{\{ secrets\.CLEANUP_DATABASE_URL \}\}/);
});

check('the deletion job runs only by hand with execute = true and the variable, and only after the dry run', () => {
  const del = J['cleanup-delete'];
  const cond = /^\s+if:\s*\$\{\{(.*)\}\}\s*$/m.exec(del);
  assert.ok(cond, 'the deletion job has an if condition');
  // Exact equality is intentional: a weaker condition (for example adding an OR branch for schedule)
  // must fail this regression test rather than merely containing the three expected fragments.
  assert.equal(
    cond[1].trim().replace(/\s+/g, ' '),
    "github.event_name == 'workflow_dispatch' && inputs.execute == true && vars.CLEANUP_EXECUTE == 'true'",
    'no alternate trigger or bypass is allowed'
  );
  assert.match(del, /^\s+needs: cleanup-dry-run\s*$/m);
});

check('the only job that runs --execute is the approval-gated deletion job', () => {
  const executing = Object.entries(J).filter(([, body]) => /--execute/.test(body)).map(([name]) => name);
  assert.deepEqual(executing, ['cleanup-delete']);
});

check('the scheduled trigger exists and the workflow keeps read-only permissions', () => {
  assert.match(text, /^on:\n\s+schedule:\n\s+- cron: '17 3 \* \* \*'/m);
  assert.match(text, /^permissions:\n\s+contents: read\s*$/m);
});

check('the job summaries state that the dry run deletes nothing', () => {
  assert.match(J["cleanup-dry-run"], /\*\*Records deleted by this run: 0\.\*\*/);
});

console.log(`\n${passed} cleanup workflow checks passed`);
