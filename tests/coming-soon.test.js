'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/home-ui.js'), 'utf8'), { window, Set, Date });
const ui = window.TVHomeUI({
  S: { guest: true, friends: [], friendRequests: { incoming: [], outgoing: [] }, invitations: { incoming: [] }, bellOpen: false },
  esc: (value) => String(value),
  gameMeta: () => null,
  pingBadge: () => '',
  pendingSocial: () => 0,
});
const html = ui.comingSoonHTML();
const buildOrder = ['Go Fish', 'Snakes and Ladders', 'Property Rivals', 'Hidden Miners', 'Bullhead Run', 'Color Clash', 'Sea Battle', 'Island Settlers — 4 players', 'Island Settlers — 5–6 players'];
const additional = ['Four in a Row', 'Secret Clues', 'Tic-Tac-Toe'];
assert.equal((html.match(/class="soon-card"/g) || []).length, 12);
let previous = -1;
for (const name of [...buildOrder, ...additional]) {
  const index = html.indexOf(name);
  assert.ok(index > previous, `roadmap order is wrong or missing: ${name}`);
  previous = index;
}
for (const protectedBrand of ['Monopoly', 'Saboteur', '6 nimmt!', 'UNO', 'CATAN', 'Connect Four', 'Codenames']) {
  assert.ok(!html.includes(protectedBrand), `protected commercial title should not be displayed: ${protectedBrand}`);
}
assert.match(html, /Development order/);
assert.match(html, /Also on the list/);
assert.match(html, /12 planned/);
assert.match(html, /original artwork and presentation/);
console.log('Coming Soon roadmap tests passed (12 games, requested order, alternate working titles).');
