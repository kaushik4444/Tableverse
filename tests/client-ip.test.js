'use strict';
// Client address for per-IP limits: a visitor must not be able to choose the address the limits see.
const assert = require('node:assert/strict');
const { clientAddress, parseTrustProxy, parseTrustProxyHops } = require('../lib/clientIp');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const req = (xff, remote = '10.0.0.9') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });

console.log('client address');
test('without a trusted proxy the socket address is used and a forged header is ignored', () => {
  assert.equal(clientAddress(req('1.2.3.4'), false), '10.0.0.9');
});
test('behind a trusted proxy the address the proxy appended (right-most) is used', () => {
  // the visitor sent "6.6.6.6"; Render appended the real address "203.0.113.7" on the right
  assert.equal(clientAddress(req('6.6.6.6, 203.0.113.7'), true), '203.0.113.7');
});
test('rotating a forged left-most address does not change the limited address', () => {
  const a = clientAddress(req('1.1.1.1, 203.0.113.7'), true);
  const b = clientAddress(req('9.9.9.9, 203.0.113.7'), true);
  assert.equal(a, b);
});
test('a missing or non-address header falls back to the socket address', () => {
  assert.equal(clientAddress(req(undefined), true), '10.0.0.9');
  assert.equal(clientAddress(req('<script>'), true), '10.0.0.9');
  assert.equal(clientAddress(req(' , '), true), '10.0.0.9');
});
test('IPv6 addresses are accepted', () => {
  assert.equal(clientAddress(req('2001:db8::1'), true), '2001:db8::1');
});

console.log('TRUST_PROXY_HOPS');
test('a direct-origin visitor cannot activate unsafe two-hop trust with a forged header', () => {
  const directOriginRequest = req('198.51.100.123, 203.0.113.8', '203.0.113.8');
  const hops = parseTrustProxyHops('2');
  assert.equal(hops, 1);
  assert.equal(clientAddress(directOriginRequest, true, hops), '203.0.113.8');
  assert.equal(clientAddress(directOriginRequest, true, 2), '203.0.113.8');
});

test('only one trusted proxy is supported; other values mean 1', () => {
  assert.equal(parseTrustProxyHops(' 1 '), 1);
  for (const v of [undefined, '', '0', '-1', '2', '2.5', 'two', '6', '99']) assert.equal(parseTrustProxyHops(v), 1, String(v));
});

console.log('TRUST_PROXY');
test('1, true and yes trust the proxy; 0, false and no do not', () => {
  for (const v of ['1', 'true', 'TRUE', ' yes ']) assert.equal(parseTrustProxy(v, false), true, v);
  for (const v of ['0', 'false', 'No']) assert.equal(parseTrustProxy(v, true), false, v);
});
test('an unset or unrecognised value keeps the production default', () => {
  assert.equal(parseTrustProxy(undefined, true), true);
  assert.equal(parseTrustProxy('', false), false);
  assert.equal(parseTrustProxy('maybe', true), true);
});

console.log(`\n${passed} client address tests passed`);
