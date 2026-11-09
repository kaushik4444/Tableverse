'use strict';
// DATABASE_URL -> pg.Pool options. No database needed: the TLS decision and the URL rewrite are checked directly.
const assert = require('node:assert/strict');
const { poolConnectionOptions, isLocalConnectionString } = require('../db/poolConfig');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const NEON = 'postgresql://app_user:s3cret@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const PROD = { NODE_ENV: 'production' };
const DEV = { NODE_ENV: 'development' };

test('a Neon URL with sslmode=require keeps verified TLS and loses the sslmode parameter (no pg warning)', () => {
  const o = poolConnectionOptions(NEON, PROD);
  assert.deepEqual(o.ssl, { rejectUnauthorized: true });
  assert.doesNotMatch(o.connectionString, /sslmode/);
  assert.match(o.connectionString, /channel_binding=require/, 'other parameters are kept');
  assert.match(o.connectionString, /ep-cool-name-123456-pooler\.eu-central-1\.aws\.neon\.tech\/neondb/, 'the host is unchanged');
});

test('require, prefer, verify-ca and verify-full all mean verified TLS (same as the pg aliases today), in any environment', () => {
  for (const mode of ['require', 'prefer', 'verify-ca', 'verify-full']) {
    for (const env of [PROD, DEV]) {
      const o = poolConnectionOptions(`postgresql://u:p@db.example.com/x?sslmode=${mode}`, env);
      assert.deepEqual(o.ssl, { rejectUnauthorized: true }, mode);
      assert.doesNotMatch(o.connectionString, /sslmode/, mode);
    }
  }
});

test('sslmode=disable turns TLS off and is removed from the URL', () => {
  const o = poolConnectionOptions('postgresql://u:p@db.example.com/x?sslmode=disable&application_name=t', PROD);
  assert.equal(o.ssl, false);
  assert.doesNotMatch(o.connectionString, /sslmode/);
  assert.match(o.connectionString, /application_name=t/);
});

test('an unknown sslmode is left in the URL for the pg library to decide', () => {
  const url = 'postgresql://u:p@db.example.com/x?sslmode=allow';
  const o = poolConnectionOptions(url, PROD);
  assert.equal(o.connectionString, url);
  assert.equal('ssl' in o, false);
});

test('production with no sslmode on a remote host is TLS with certificate checks (a forgotten ?sslmode= is never plaintext)', () => {
  const url = 'postgresql://u:p@db.example.com/x';
  const o = poolConnectionOptions(url, PROD);
  assert.deepEqual(o.ssl, { rejectUnauthorized: true });
  assert.equal(o.connectionString, url);
});

test('production with no sslmode on a local host does not force TLS', () => {
  for (const url of ['postgresql://u:p@localhost:5432/x', 'postgresql://u:p@127.0.0.1/x', 'postgres://u@[::1]:5432/x']) {
    const o = poolConnectionOptions(url, PROD);
    assert.equal('ssl' in o, false, url);
  }
});

test('outside production, no sslmode means the pg library default', () => {
  const o = poolConnectionOptions('postgresql://u:p@db.example.com/x', DEV);
  assert.equal('ssl' in o, false);
});

test('a string that is not a URL is passed through unchanged, even with sslmode in it', () => {
  const odd = 'host=db.example.com sslmode=require dbname=x';
  const o = poolConnectionOptions(odd, PROD);
  assert.equal(o.connectionString, odd);
  assert.deepEqual(o.ssl, { rejectUnauthorized: true }, 'production still forces TLS for a remote host');
});

test('a Unix socket URL (host parameter) counts as local', () => {
  assert.equal(isLocalConnectionString('postgresql:///x?host=/var/run/postgresql'), true);
  assert.equal(isLocalConnectionString('postgresql://u:p@db.example.com/x'), false);
});

test('the returned URL never contains the password in a changed form', () => {
  const o = poolConnectionOptions(NEON, PROD);
  assert.match(o.connectionString, /app_user:s3cret@/);
});

console.log(`  ${passed} pool config checks passed`);
