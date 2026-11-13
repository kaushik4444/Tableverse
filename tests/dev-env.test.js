'use strict';
// Local development safety rules (lib/devEnv.js): what the dev tools refuse, and the generated password.
const assert = require('node:assert/strict');
const { parseEnvFile, assertSafeDevEnv, generatePassword, devDefaults, DevEnvError } = require('../lib/devEnv');
const policy = require('../public/password-policy');
let passed = 0;
const test = (name, fn) => { try { fn(); passed += 1; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL  ' + name + '\n' + (e && e.stack)); process.exitCode = 1; } };
const refused = (env, re) => assert.throws(() => assertSafeDevEnv(env), (e) => e instanceof DevEnvError && re.test(e.message));

test('an .env file is parsed: comments, quotes, export, trailing comments, blank lines', () => {
  const out = parseEnvFile('# a comment\n\nPORT=3100\nexport A="x y"\nB=\'q\'\nC=plain # note\nBAD LINE\nD=\nE = spaced \n');
  assert.deepEqual(out, { PORT: '3100', A: 'x y', B: 'q', C: 'plain', D: '', E: 'spaced' });
  assert.deepEqual(parseEnvFile('X=1\r\nY=2\r\n'), { X: '1', Y: '2' }, 'Windows line endings');
  assert.deepEqual(parseEnvFile(undefined), {});
});
test('production is refused, whatever else is set', () => {
  refused({ NODE_ENV: 'production' }, /NODE_ENV=production/);
  refused({ NODE_ENV: 'Production', DATABASE_URL: 'postgres://u@localhost/db' }, /NODE_ENV=production/);
});
test('a database on this machine is accepted, and no database at all is allowed (guest play)', () => {
  for (const url of ['postgres://postgres:x@localhost:5432/tv', 'postgresql://u@127.0.0.1:55432/tv', 'postgres://u@[::1]/tv']) assert.ok(assertSafeDevEnv({ DATABASE_URL: url }));
  assert.equal(assertSafeDevEnv({}), null);
});
test('managed and production-like hosts are refused, even with the remote switch', () => {
  for (const host of ['ep-cool-123.eu-central-1.aws.neon.tech', 'dpg-abc.frankfurt-postgres.render.com', 'db.abc.supabase.co', 'x.rds.amazonaws.com', 'ep-cool-123.eu-central-1.aws.neon.tech.', 'db.abc.supabase.co.']) {
    refused({ DATABASE_URL: `postgres://u:p@${host}/db` }, /managed/);
    refused({ DATABASE_URL: `postgres://u:p@${host}/db`, ALLOW_REMOTE_DEV_DB: '1' }, /managed/);
  }
});
test('another remote host needs the explicit switch', () => {
  refused({ DATABASE_URL: 'postgres://u:p@db.example.org/tv' }, /non-local/);
  assert.ok(assertSafeDevEnv({ DATABASE_URL: 'postgres://u:p@db.example.org/tv', ALLOW_REMOTE_DEV_DB: '1' }));
});
test('a malformed or non-postgres URL is refused', () => {
  refused({ DATABASE_URL: 'not a url' }, /not a valid URL/);
  refused({ DATABASE_URL: 'mysql://u@localhost/db' }, /postgres/);
});
test('generated passwords always satisfy the password rule and are not repeated', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) { const pw = generatePassword(); assert.equal(policy.check(pw), null, pw); assert.equal(pw.length, 20); seen.add(pw); }
  assert.equal(seen.size, 300);
});
test('e-mail verification is optional locally unless set, and an explicit value wins', () => {
  assert.deepEqual(devDefaults({}), { REQUIRE_EMAIL_VERIFICATION: 'false' });
  assert.deepEqual(devDefaults({ REQUIRE_EMAIL_VERIFICATION: 'true' }), { REQUIRE_EMAIL_VERIFICATION: 'true' });
});
test('a host or hostaddr query parameter is refused: it would override the host the check sees', () => {
  refused({ DATABASE_URL: 'postgres://u:p@localhost/db?host=ep-x.eu-central-1.aws.neon.tech' }, /host or hostaddr/);
  refused({ DATABASE_URL: 'postgres://u:p@127.0.0.1/db?hostaddr=203.0.113.9' }, /host or hostaddr/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost/db?host=/var/run/postgresql' }, /host or hostaddr/);
});
test('several hosts in one URL are refused, so only the one checked host can be used', () => {
  assert.throws(() => assertSafeDevEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432,ep-x.eu-central-1.aws.neon.tech:5432/db' }), DevEnvError);
});
console.log(`${passed} local development tests passed`);
