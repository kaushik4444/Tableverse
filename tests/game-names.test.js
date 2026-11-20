'use strict';
// Game names: the display names are the decided ones, the internal ids did not change (saved matches, stats and links
// use the ids), the three games carry the non-affiliation line, and no old name is left in what players or search engines see.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const registry = require('../games');

const root = path.join(__dirname, '..');
const games = registry.list ? registry.list() : Object.values(registry.registry || registry);
const byId = Object.fromEntries(games.map((g) => [g.id, g]));

const NAMES = { wizard: 'Wizard', penaltyrows: 'Take 5', stagerummy: 'Stage 10', themind: 'Mind' };
for (const [id, name] of Object.entries(NAMES)) {
  assert.ok(byId[id], `the game id ${id} still exists`);
  assert.equal(byId[id].name, name, `${id} is shown as ${name}`);
}

for (const id of ['penaltyrows', 'stagerummy', 'themind']) {
  const rules = (byId[id].rules || []).join('\n');
  assert.match(rules, /not affiliated with, endorsed by or licensed by the publisher/, `${id} says it is not affiliated with a publisher`);
}

// No old name in code, pages, docs or What's New (the naming review doc and the tests are the only places that may name them).
const OLD = /Penalty Rows|Stage Rummy|The Mind|Phase 10|6 nimmt/i;
const ALLOWED = new Set(['docs/GAME_NAMES.md']);
// The rename notes (What's New, changelog) name the old titles once, so players can tell which game is meant: only a line saying "now".
const RENAME_NOTES = new Set(['CHANGELOG.md', 'public/whats-new-data.js']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'tests', 'package-lock.json'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|css|html|md|json|yml|yaml|txt|svg)$/.test(e.name)) out.push(full);
  }
  return out;
}
const hits = [];
for (const f of walk(root)) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  if (ALLOWED.has(rel)) continue;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (OLD.test(line) && !(RENAME_NOTES.has(rel) && /\bnow\b/.test(line))) hits.push(`${rel}:${i + 1}`); });
}
assert.deepEqual(hits, [], `old game names remain in: ${hits.join(', ')}`);

// The ids appear unchanged in the registry source.
const registrySource = fs.readFileSync(path.join(root, 'games/index.js'), 'utf8');
for (const id of ['penaltyrows', 'stagerummy', 'themind']) assert.match(registrySource, new RegExp(`\\b${id}:`), `${id} is still registered`);

console.log('game name tests passed');
