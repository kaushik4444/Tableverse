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
// What's new: the release history is public/whats-new-data.js; the home page shows the newest release's first three items.
const releaseSource = fs.readFileSync(require.resolve('../public/whats-new-data.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(releaseSource, sandbox);
const releases = sandbox.window.TV_RELEASES;
assert.ok(Array.isArray(releases) && releases.length >= 3, 'the release history keeps every version (newest first)');
const newest = releases[0];
const highlights = newest.items.slice(0, 3).map((i) => i.title).join('\n');
assert.equal(newest.items.slice(0, 3).length, 3, 'the home page shows three highlights');
// The newest release is the guest play release (its first three items). The older highlights stay in the history.
assert.equal(newest.version, '2026-11-18-guest-play');
assert.match(highlights, /Play without an account/);
assert.match(highlights, /Some games need an account/);
assert.match(highlights, /Quiet reminders/);
const history = releases.flatMap((r) => r.items.map((i) => i.title)).join('\n');
assert.match(history, /Game XP at the end of a game, in one table/);
assert.match(history, /Level-up dialog/);
assert.match(history, /See how far you are to the next level/);
assert.match(history, /A level-up notice, once/);
assert.match(history, /Follow @playtableverse on Instagram/);
assert.ok(releases.some((r) => r.items.some((i) => /Leaving a game with others counts as a loss/.test(i.title))), 'the earlier release stays in the history');
assert.ok(releases.every((r) => r.version && r.title && Array.isArray(r.items) && r.items.length > 0), 'every release has a version, title and items');
assert.equal(new Set(releases.map((r) => r.version)).size, releases.length, 'versions are unique');
// Release cleanup: inspect the full historical entry, not just the home highlights.
// A fourth admin-only item would otherwise escape the first-three assertions above.
const gameOverRelease = releases.find((r) => r.version === '2026-11-17-game-over-table');
assert.ok(gameOverRelease, 'the game-over release remains in version history');
assert.equal(gameOverRelease.date, '2026-11-17');
assert.equal(gameOverRelease.title, 'One table at the end of a game');
assert.deepEqual(Array.from(gameOverRelease.items, (item) => item.title), [
  'Game XP at the end of a game, in one table',
  'Your lifetime XP in each game',
  'Level-up dialog',
], 'the historical release keeps all three player-facing items in order');
for (const item of gameOverRelease.items) {
  assert.ok(typeof item.ico === 'string' && item.ico.trim(), `${item.title} has an icon`);
  assert.ok(typeof item.text === 'string' && item.text.trim(), `${item.title} has explanatory text`);
  assert.notEqual(item.voice, true, `${item.title} remains visible with voice chat off`);
  assert.doesNotMatch(`${item.title}\n${item.text}`, /admin|sort|player directory/i,
    'admin sorting and player-directory changes are not advertised in this release');
}
const appSource = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
assert.match(appSource, /window\.TV_RELEASES/, 'the app reads the release history');
assert.match(appSource, /openVersionHistory/, 'the account menu opens the version history');

for (const shipped of ['Private tables and invitations', 'Host tools', 'Player cards', 'Profiles and history']) {
  assert.ok(!highlights.includes(shipped), shipped + ' is not a highlight');
}
assert.match(appSource, /<h3 class="stat-h"[^\n]*r\.version/, 'each Version history heading shows its version, since older releases have no date');
assert.doesNotMatch(appSource, /confirm\(/, 'important actions use in-app confirmation dialogs');
console.log('Coming Soon and latest-release-note tests passed (7 games, requested order, alternate working titles, 3 current highlights).');
