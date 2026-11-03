'use strict';
// Static file serving: cached, gzip for text, ETag/304, no stale content after an edit, nothing outside the folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { createStaticFiles } = require('../lib/staticFiles');

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-static-'));
const big = 'console.log("hello");\n'.repeat(400);
fs.writeFileSync(path.join(dir, 'app.js'), big);
fs.writeFileSync(path.join(dir, 'tiny.js'), 'x=1');
fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.alloc(4000, 1));
const sf = createStaticFiles();
const TYPES = { '.js': 'text/javascript', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(dir, req.url.slice(1));
  sf.load(file, TYPES[path.extname(file)] || 'application/octet-stream', (err, entry) => {
    if (err) { res.writeHead(404); return res.end(); }
    sf.respond(req, res, entry, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' });
  });
});
const get = (p, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  const r = http.request({ port: server.address().port, path: p, headers, method }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  r.on('error', reject); r.end();
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  await test('text is sent gzipped to browsers that accept it, and decompresses to the file', async () => {
    const r = await get('/app.js', { 'accept-encoding': 'gzip, deflate' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.equal(r.headers.vary, 'Accept-Encoding');
    assert.ok(r.body.length < big.length / 4, 'much smaller on the wire');
    assert.equal(zlib.gunzipSync(r.body).toString(), big);
    assert.equal(Number(r.headers['content-length']), r.body.length);
  });

  await test('without Accept-Encoding the plain file is sent', async () => {
    const r = await get('/app.js');
    assert.equal(r.headers['content-encoding'], undefined);
    assert.equal(r.body.toString(), big);
  });

  await test('small files and images are not compressed', async () => {
    assert.equal((await get('/tiny.js', { 'accept-encoding': 'gzip' })).headers['content-encoding'], undefined);
    assert.equal((await get('/pic.png', { 'accept-encoding': 'gzip' })).headers['content-encoding'], undefined);
  });

  await test('a matching ETag gets 304 with no body; a different one gets the file', async () => {
    const first = await get('/app.js');
    const etag = first.headers.etag;
    assert.ok(etag);
    const again = await get('/app.js', { 'if-none-match': etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    assert.equal((await get('/app.js', { 'if-none-match': 'W/"nope"' })).status, 200);
  });

  await test('editing a file on disk is picked up on the next request (no stale cache)', async () => {
    const before = (await get('/tiny.js')).headers.etag;
    fs.writeFileSync(path.join(dir, 'tiny.js'), 'x=22222');
    const future = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'tiny.js'), future, future);
    const r = await get('/tiny.js');
    assert.equal(r.body.toString(), 'x=22222');
    assert.notEqual(r.headers.etag, before);
  });

  await test('HEAD has headers and no body; a missing file is 404', async () => {
    const h = await get('/app.js', {}, 'HEAD');
    assert.equal(h.status, 200);
    assert.equal(h.body.length, 0);
    assert.equal((await get('/missing.js')).status, 404);
  });

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed`);
})();
