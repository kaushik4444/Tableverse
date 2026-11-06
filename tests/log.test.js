'use strict';
// Structured logs must never write a password, token, key, database URL or full e-mail address.
const assert = require('node:assert/strict');
const { createLogger, redactText, redact, requestIdFrom } = require('../lib/log');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const DB_URL = 'postgres://tv_app:Sup3rSecretPw@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const RESEND_KEY = 're_AbCdEf123456_secretvalue';

test('database URLs lose their credentials wherever they appear in text', () => {
  const out = redactText(`connect failed for ${DB_URL}`);
  assert.ok(!out.includes('Sup3rSecretPw'), out);
  assert.ok(!out.includes('tv_app:'), out);
  assert.match(out, /postgres:\/\/\[redacted\]@ep-cool-name/);
});

test('key=value and JSON-style secrets are masked', () => {
  assert.equal(redactText('token=abc123def456 next'), 'token=[redacted] next');
  assert.ok(!redactText('{"password":"hunter2hunter2"}').includes('hunter2'));
  assert.ok(!redactText('Authorization: Bearer eyJhbGciOi.sig').includes('eyJhbGciOi'));
});

// Regression: a quoted secret used to be masked only up to its first space, comma, ampersand or escaped quote, leaving
// the rest of the password in logs. Each fragment below must be gone from the output.
test('a quoted password is masked in full: spaces, commas, ampersands and escaped quotes', () => {
  const cases = [
    { input: '{"password":"correct horse battery staple"}', leaks: ['horse', 'battery', 'staple'] },
    { input: '{"password":"a,b,c"}', leaks: ['b,c'] },
    { input: '{"password":"x&y=z"}', leaks: ['&y=z'] },
    { input: '{"password":"say \\"hi\\" now"}', leaks: ['hi', 'now'] },
    { input: "{ password: 'two words, & more' }", leaks: ['words', 'more'] },
    { input: '{"password":"abc def', leaks: ['def'] }, // unterminated: masked to the end
  ];
  for (const { input, leaks } of cases) {
    const out = redactText(input);
    assert.match(out, /\[redacted\]/, out);
    for (const fragment of leaks) assert.ok(!out.includes(fragment), `"${fragment}" leaked in: ${out}`);
  }
});

test('a password inside an error message keeps the message readable and loses the secret', () => {
  const out = redactText('Error: login failed for ada password="pass word, & more" (attempt 2)');
  assert.ok(!out.includes('pass word') && !out.includes('more'), out);
  assert.match(out, /login failed for ada password="\[redacted\]" \(attempt 2\)/);
});

test('a password in an escaped JSON string (as logged inside another JSON field) is masked', () => {
  const out = redactText('{"body":"{\\"password\\":\\"two words\\"}"}');
  assert.ok(!out.includes('two words'), out);
});

test('secrets inside a stack trace are masked on every line that carries them', () => {
  const err = new Error('request body {"password":"hunter two & three"} was rejected');
  err.stack = [
    'Error: request body {"password":"hunter two & three"} was rejected',
    '    at parseBody (/app/lib/http.js:12:9)',
    '    at handle (/app/lib/routes.js:40:3) password: "tail end, of secret"',
  ].join('\n');
  const serialised = JSON.stringify(redact({ err }));
  for (const fragment of ['hunter', 'three', 'tail end', 'of secret']) {
    assert.ok(!serialised.includes(fragment), `"${fragment}" leaked: ${serialised}`);
  }
  assert.ok(serialised.includes('parseBody'), 'the stack still shows where it failed');
});

// Regression: short password names and CSRF tokens were logged in clear as object fields.
test('object fields named pw, pwd, passwd, csrf or X-CSRF are masked wherever they nest', () => {
  const out = redact({
    csrf: 'CSRFVAL1', ct_csrf: 'CSRFVAL2', pw: 'PWVAL1', pwd: 'PWVAL2', passwd: 'PWVAL3', newPassword: 'PWVAL4',
    headers: { 'X-CSRF': 'CSRFVAL4' }, rows: [{ pwd: 'PWVAL6' }], roomCode: 'ABCD',
  });
  const serialised = JSON.stringify(out);
  for (const fragment of ['CSRFVAL', 'PWVAL']) assert.ok(!serialised.includes(fragment), serialised);
  assert.equal(out.roomCode, 'ABCD', 'ordinary fields are not masked');
});

test('a JSON-style secret logged as a field keeps valid JSON around the mask', () => {
  const lines = [];
  const log = createLogger({ write: (level, line) => lines.push(line) });
  log.error('auth.failed', { body: { password: 'two words, & more', email: 'ada@example.com' } });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.body.password, '[redacted]');
  assert.ok(!lines[0].includes('two words') && !lines[0].includes('more'));
});

// Regression: names that carry a prefix or suffix (secret_key, password_hash, session_id), cookie headers, Basic auth,
// and a URL whose password holds an unencoded @ all leaked part or all of the secret.
test('compound secret names, cookies, Basic auth and unencoded @ in URL passwords are masked', () => {
  const cases = [
    ['config secret_key=s3cr3tVALUE rejected', 's3cr3tVALUE'],
    ['row password_hash=$argon2id$v=19$SECRETHASH', 'SECRETHASH'],
    ['session_id=sidSECRETVALUE expired', 'sidSECRETVALUE'],
    ['Cookie: ct_session=abc123SECRETxyz; ct_csrf=csrfSECRETval', 'abc123SECRETxyz'],
    ['Cookie: ct_session=abc123SECRETxyz; ct_csrf=csrfSECRETval', 'csrfSECRETval'],
    ['Authorization: Basic dXNlcjpTRUNSRVRwYXNz', 'dXNlcjpTRUNSRVRwYXNz'],
    ['connect postgres://u:pa@SECRETss@db.example.net/app failed', 'SECRETss'],
    ['access_token=accSECRETVALUE', 'accSECRETVALUE'],
    ['{"client_secret": "two SECRET words"}', 'SECRET'],
  ];
  for (const [input, secret] of cases) {
    const out = redactText(input);
    assert.ok(!out.includes(secret), `"${secret}" leaked in: ${out}`);
  }
});

test('Resend-style API keys are masked', () => {
  assert.ok(!redactText(`key ${RESEND_KEY} rejected`).includes('secretvalue'));
});

test('e-mail addresses are masked to the first letter and domain', () => {
  assert.equal(redactText('sent to ada.lovelace@example.com'), 'sent to a***@example.com');
});

test('sensitive object fields are replaced by name, whatever their content', () => {
  const out = redact({ roomCode: 'ABCD', verifyToken: 'x'.repeat(40), password: 'p', databaseUrl: DB_URL, nested: { apiKey: 'k' } });
  assert.equal(out.roomCode, 'ABCD');
  assert.equal(out.verifyToken, '[redacted]');
  assert.equal(out.password, '[redacted]');
  assert.equal(out.databaseUrl, '[redacted]');
  assert.equal(out.nested.apiKey, '[redacted]');
});

test('an Error is flattened to name, code, scrubbed message and stack', () => {
  const err = new Error(`boom for ${DB_URL}`);
  err.code = '28P01';
  const out = redact({ err });
  assert.equal(out.err.code, '28P01');
  assert.equal(out.err.name, 'Error');
  assert.ok(!JSON.stringify(out).includes('Sup3rSecretPw'));
});

test('a logged line is one JSON object with time, level, component, event and scrubbed fields', () => {
  const lines = [];
  const log = createLogger({ component: 'db', write: (level, line) => lines.push({ level, line }), clock: () => new Date('2026-11-06T12:00:00Z') });
  log.error('db.pool_error', { code: '57P01', detail: DB_URL, verifyToken: 'abcdefghijklmnop' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'error');
  const entry = JSON.parse(lines[0].line);
  assert.deepEqual(Object.keys(entry).slice(0, 4), ['time', 'level', 'component', 'event']);
  assert.equal(entry.event, 'db.pool_error');
  assert.equal(entry.component, 'db');
  assert.equal(entry.time, '2026-11-06T12:00:00.000Z');
  assert.equal(entry.verifyToken, '[redacted]');
  assert.ok(!lines[0].line.includes('Sup3rSecretPw'));
});

test('info goes to the info channel, warnings and errors to the error channel', () => {
  const seen = [];
  const log = createLogger({ write: (level) => seen.push(level) });
  log.info('a'); log.warn('b'); log.error('c');
  assert.deepEqual(seen, ['info', 'warn', 'error']);
});

test('a caller-supplied request ID is kept only when it is a plain token', () => {
  assert.equal(requestIdFrom('abc-DEF_123.456'), 'abc-DEF_123.456');
  const injected = requestIdFrom('ok\nSet-Cookie: x=1');
  assert.match(injected, /^[0-9a-f-]{36}$/);
  assert.match(requestIdFrom(undefined), /^[0-9a-f-]{36}$/);
  assert.match(requestIdFrom('short'), /^[0-9a-f-]{36}$/);
});

console.log(`\n${passed} log tests passed`);
