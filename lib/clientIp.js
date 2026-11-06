'use strict';
/**
 * Client address for per-address limits.
 *
 * Every proxy in front of the app APPENDS the address it received to X-Forwarded-For, so anything the client sent sits on
 * the LEFT and the entries added by our proxies sit on the RIGHT. With `hops` trusted proxies in front of us, the client
 * address is the entry `hops` places from the right:
 *   - Render alone (hops = 1): "<client-sent…>, <client-address>"  -> the right-most entry.
 *   - Cloudflare proxy + Render (hops = 2): "<client-sent…>, <client-address>, <cloudflare-edge>" -> the second from the right.
 * Reading the left-most entry instead would let any visitor choose their own address and dodge every per-address limit.
 */

const SIMPLE_ADDRESS = /^[0-9a-fA-F:.]{2,45}$/; // IPv4 or IPv6 text; anything else is ignored

function clientAddress(req, trustProxy, hops = 1) {
  const socketAddress = (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!trustProxy) return socketAddress;
  // Multi-hop trust is unsafe unless the proxy chain is validated against trusted addresses.
  if (hops !== 1) return socketAddress;
  const header = String(req.headers['x-forwarded-for'] || '');
  const parts = header.split(',').map((s) => s.trim()).filter(Boolean);
  const candidate = parts[parts.length - 1] || '';
  return SIMPLE_ADDRESS.test(candidate) ? candidate : socketAddress;
}

/** TRUST_PROXY accepts 1/true/yes (trust) and 0/false/no (do not trust). Anything else keeps the production default. */
function parseTrustProxy(value, production) {
  const v = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(v)) return true;
  if (['0', 'false', 'no'].includes(v)) return false;
  return production;
}

/** TRUST_PROXY_HOPS: only one proxy is trusted until multi-hop chains can be validated against trusted addresses. */
function parseTrustProxyHops(value) {
  return 1;
}

module.exports = { clientAddress, parseTrustProxy, parseTrustProxyHops };
