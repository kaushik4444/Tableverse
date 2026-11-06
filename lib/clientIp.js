'use strict';
/**
 * Client address for per-address limits.
 *
 * Behind one trusted proxy (Render), each proxy APPENDS the address it received to X-Forwarded-For. Anything the client
 * sent in that header therefore sits on the LEFT, and the entry the trusted proxy added is the RIGHT-most one. Reading the
 * left-most entry would let any visitor pick their own address and dodge every per-address limit by sending a new value.
 */

const SIMPLE_ADDRESS = /^[0-9a-fA-F:.]{2,45}$/; // IPv4 or IPv6 text; anything else is ignored

function clientAddress(req, trustProxy) {
  const socketAddress = (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!trustProxy) return socketAddress;
  const header = String(req.headers['x-forwarded-for'] || '');
  const parts = header.split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  return SIMPLE_ADDRESS.test(last) ? last : socketAddress;
}

/** TRUST_PROXY accepts 1/true/yes (trust) and 0/false/no (do not trust). Anything else keeps the production default. */
function parseTrustProxy(value, production) {
  const v = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(v)) return true;
  if (['0', 'false', 'no'].includes(v)) return false;
  return production;
}

module.exports = { clientAddress, parseTrustProxy };
