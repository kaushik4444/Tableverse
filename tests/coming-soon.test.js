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
const buildOrder = ['Hidden Miners', 'Bullhead Run', 'Color Clash', 'Sea Battle', 'Resource Isles — 4 players', 'Resource Isles — 5–6 players'];
const additional = ['Secret Clues'];
assert.equal((html.match(/class="soon-card[ "]/g) || []).length, 7);
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
assert.equal((html.match(/>In development</g) || []).length, 1, 'exactly one game is in development');
assert.match(html, /Hidden Miners[\s\S]*?>In development</);
assert.equal((html.match(/>Planned</g) || []).length, 6, 'the others are planned');
assert.match(html, /Also on the list/);
assert.match(html, /7 planned/);
assert.match(html, /original artwork and presentation/);
const appSource = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const whatsNew = appSource.match(/const WHATS_NEW = \[([\s\S]*?)\n  \];/);
assert.ok(whatsNew, 'What’s new release notes exist');
assert.equal((whatsNew[1].match(/^\s*\[/gm) || []).length, 3, 'What’s new only contains the latest three highlights');
assert.ok(!html.includes('Snakes and Ladders'), 'a playable game is not listed as coming soon');
assert.match(whatsNew[1], /Smoother, tidier games/);
assert.match(whatsNew[1], /Talk at the table/);
assert.match(whatsNew[1], /A proper ending/);
for (const shipped of ['Four in a Row', 'Tic-Tac-Toe']) assert.ok(!html.includes(shipped), `${shipped} is playable, not coming soon`);
assert.ok(!html.includes('Property Rivals'), 'a playable game is not listed as coming soon');
assert.doesNotMatch(whatsNew[1], /Private tables and invitations|Host tools|Player cards|Profiles and history/);
assert.doesNotMatch(appSource, /confirm\(/, 'important actions use in-app confirmation dialogs');
console.log('Coming Soon and latest-release-note tests passed (7 games, requested order, alternate working titles, 3 current highlights).');
