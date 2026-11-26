'use strict';
// Every sound name the code asks for exists in public/sound.js. A typo here would make a sound silently never play.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const soundSrc = fs.readFileSync(path.join(PUBLIC, 'sound.js'), 'utf8');
// the keys of the SOUNDS table: "name: () =>" or "name: (arg) =>" at the start of a line
const defined = new Set([...soundSrc.matchAll(/^\s{4}([a-z]+): \(/gm)].map((m) => m[1]));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

// string literals passed to sound play: snd.play('x'), sound.play(c ? 'x' : 'y'), play(...) inside a sound call
const used = new Map();
for (const file of walk(PUBLIC)) {
  if (path.basename(file) === 'sound.js') continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bsnd(?:\.sound)?\.play\(([^;]*?)\)[;,)]|\bsound\.play\(([^;]*?)\)[;,)]|CardTable\.sound\.play\(([^;]*?)\)[;,)]/g)) {
    const args = m[1] || m[2] || m[3] || '';
    for (const lit of args.matchAll(/'([a-z]+)'/g)) {
      // a literal in a comparison (e.type === 'lay') is a condition, not a sound name
      const before = args.slice(Math.max(0, lit.index - 6), lit.index);
      if (/[=!]==?\s*$/.test(before)) continue;
      if (!used.has(lit[1])) used.set(lit[1], []);
      used.get(lit[1]).push(path.relative(PUBLIC, file));
    }
  }
}

assert.ok(defined.size >= 25, `expected the SOUNDS table to be read (found ${defined.size})`);
assert.ok(used.size >= 20, `expected to find the sound calls (found ${used.size})`);
const missing = [...used.keys()].filter((n) => !defined.has(n));
assert.deepEqual(missing, [], `sound names used but not defined in sound.js: ${missing.join(', ')}`);

for (const n of ['start', 'join', 'leave', 'notify', 'check', 'dice']) assert.ok(defined.has(n), `${n} is defined`);
console.log(`sounds: ${used.size} sound names used, all of them defined (${defined.size} defined)`);
