'use strict';
/** Syntax-checks every JavaScript file in the project (so a new file can never be forgotten in package.json). */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.js')) files.push(full);
  }
})(ROOT);

let bad = 0;
for (const f of files.sort()) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`syntax error in ${path.relative(ROOT, f)}\n${r.stderr}`); }
}
console.log(`${files.length} JavaScript files checked, ${bad} with errors`);
process.exit(bad ? 1 : 0);
