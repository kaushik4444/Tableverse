'use strict';
/**
 * Static files for the browser client: read once, kept in memory (re-read when the file changes on disk), gzip-compressed
 * once for text types, with an ETag so a reload costs a 304 instead of the whole script. Used by server.js.
 */
const fs = require('node:fs');
const zlib = require('node:zlib');

const COMPRESSIBLE = new Set(['text/html', 'text/css', 'text/javascript', 'application/javascript', 'application/json', 'image/svg+xml', 'application/manifest+json']);
const MAX_ENTRIES = 300;

function createStaticFiles() {
  const cache = new Map(); // absolute path -> { mtimeMs, size, data, gz, etag }

  /** cb(err, entry). Stats the file on every call (cheap) and only re-reads it when it changed. */
  function load(file, type, cb) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return cb(err || new Error('not a file'));
      const hit = cache.get(file);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return cb(null, hit);
      fs.readFile(file, (readErr, data) => {
        if (readErr) return cb(readErr);
        const mime = String(type).split(';')[0];
        const gz = COMPRESSIBLE.has(mime) && data.length > 1024 ? zlib.gzipSync(data, { level: 6 }) : null;
        const entry = { mtimeMs: st.mtimeMs, size: st.size, data, gz, etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"` };
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
        cache.set(file, entry);
        cb(null, entry);
      });
    });
  }

  /** Answers 304, or 200 with the compressed body when the browser accepts gzip. headers: the response headers apart from the body's. */
  function respond(req, res, entry, headers) {
    const h = { ...headers, ETag: entry.etag, Vary: 'Accept-Encoding' };
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').some((t) => t.trim() === entry.etag)) {
      res.writeHead(304, h);
      return res.end();
    }
    const useGzip = entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    const body = useGzip ? entry.gz : entry.data;
    res.writeHead(200, { ...h, ...(useGzip ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return { load, respond, size: () => cache.size };
}

module.exports = { createStaticFiles };
