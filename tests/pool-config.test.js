'use strict';
// DATABASE_URL -> pg.Pool options. No database needed: the rewrite and the production TLS default are checked directly.
const assert = require('node:assert/strict');
const { poolConnectionOptions, isLocalConnectionString } = require('../db/poolConfig');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const NEON = 'postgresql://app_user:s3cret@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const PROD = { NODE_ENV: 'production' };
const DEV = { NODE_ENV: 'development' };

test('a Neon URL with sslmode=require is rewritten to sslmode=verify-full (same TLS, no pg warning), other parameters kept', () => {
  const o = poolConnectionOptions(NEON, PROD);
  assert.match(o.connectionString, /sslmode=verify-full/);
  assert.doesNotMatch(o.connectionString, /sslmode=require/);
  assert.match(o.connectionString, /channel_binding=require/, 'other parameters are kept');
  assert.match(o.connectionString, /ep-cool-name-123456-pooler\.eu-central-1\.aws\.neon\.tech\/neondb/, 'the host is unchanged');
  assert.match(o.connectionString, /app_user:s3cret@/, 'credentials are kept as they were');
  assert.equal('ssl' in o, false, 'no explicit ssl option: the URL alone decides TLS');
});

test('require, prefer and verify-ca become verify-full; verify-full stays', () => {
  for (const mode of ['require', 'prefer', 'verify-ca']) {
    const o = poolConnectionOptions(`postgresql://u:p@db.example.com/x?sslmode=${mode}`, DEV);
    assert.match(o.connectionString, /sslmode=verify-full/, mode);
  }
  const same = 'postgresql://u:p@db.example.com/x?sslmode=verify-full';
  assert.equal(poolConnectionOptions(same, PROD).connectionString, same);
});

test('sslmode=disable is left exactly as given', () => {
  const url = 'postgresql://u:p@db.example.com/x?sslmode=disable&application_name=t';
  const o = poolConnectionOptions(url, PROD);
  assert.equal(o.connectionString, url);
  assert.equal('ssl' in o, false);
});

test('an unknown sslmode is left exactly as given', () => {
  const url = 'postgresql://u:p@db.example.com/x?sslmode=allow';
  assert.equal(poolConnectionOptions(url, PROD).connectionString, url);
});

test('other TLS parameters (ssl, sslrootcert) mean the URL is left alone, so their precedence is unchanged', () => {
  for (const url of [
    'postgresql://u:p@db.example.com/x?sslmode=require&ssl=0',
    'postgresql://u:p@db.example.com/x?sslmode=require&sslrootcert=/etc/ca.pem',
  ]) {
    assert.equal(poolConnectionOptions(url, PROD).connectionString, url, url);
  }
});

test('a repeated sslmode is left alone (the two readers could disagree on which one counts)', () => {
  for (const url of [
    'postgresql://u:p@db.example.com/x?sslmode=require&sslmode=disable',
    'postgresql://u:p@db.example.com/x?sslmode=disable&sslmode=require',
  ]) {
    assert.equal(poolConnectionOptions(url, PROD).connectionString, url, url);
  }
});

test('uselibpqcompat is left alone: it changes what require and verify-ca mean', () => {
  const url = 'postgresql://u:p@db.example.com/x?sslmode=require&uselibpqcompat=true';
  assert.equal(poolConnectionOptions(url, PROD).connectionString, url);
});

test('production with no sslmode on a remote host forces verified TLS (a forgotten ?sslmode= is never plaintext)', () => {
  const url = 'postgresql://u:p@db.example.com/x';
  const o = poolConnectionOptions(url, PROD);
  assert.deepEqual(o.ssl, { rejectUnauthorized: true });
  assert.equal(o.connectionString, url);
});

test('production with no sslmode on a local host does not force TLS', () => {
  for (const url of ['postgresql://u:p@localhost:5432/x', 'postgresql://u:p@127.0.0.1/x', 'postgres://u@[::1]:5432/x']) {
    assert.equal('ssl' in poolConnectionOptions(url, PROD), false, url);
  }
});

test('outside production, no sslmode means the pg library default', () => {
  assert.equal('ssl' in poolConnectionOptions('postgresql://u:p@db.example.com/x', DEV), false);
});

test('a string that is not a URL is passed through unchanged; production still forces TLS for a remote host', () => {
  const odd = 'host=db.example.com sslmode=require dbname=x';
  const o = poolConnectionOptions(odd, PROD);
  assert.equal(o.connectionString, odd);
  assert.deepEqual(o.ssl, { rejectUnauthorized: true });
});

test('a Unix socket URL (host parameter) counts as local', () => {
  assert.equal(isLocalConnectionString('postgresql:///x?host=/var/run/postgresql'), true);
  assert.equal(isLocalConnectionString('postgresql://u:p@db.example.com/x'), false);
});

console.log(`  ${passed} pool config checks passed`);
