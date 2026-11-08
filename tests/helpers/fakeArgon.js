'use strict';
/** Lets DB-free tests load db/auth.js when the native Argon2 package is not installed (no password is ever hashed in these tests). */
const Module = require('node:module');
try { require.resolve('@node-rs/argon2'); } catch {
  const orig = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === '@node-rs/argon2') return { hash: async (p) => `fake:${p}`, verify: async (h, p) => h === `fake:${p}`, Algorithm: { Argon2id: 2 } };
    return orig.call(this, request, ...rest);
  };
}
