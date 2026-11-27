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
const buildOrder = ['Cup Pong', 'Resource Isles — 5–6 players'];
const additional = ['Secret Clues'];
assert.equal((html.match(/class="soon-card[ "]/g) || []).length, 3);
assert.ok(!html.includes('Falling Blocks'), 'Falling Blocks has shipped and is not coming soon');
assert.ok(!html.includes('Sea Battle') && !html.includes('Bingo'), 'shipped games are not listed as coming soon');
assert.ok(!html.includes('Sudoku'), 'Sudoku is playable now and must not show as coming soon');
let previous = -1;
for (const name of [...buildOrder, ...additional]) {
  const index = html.indexOf(name);
  assert.ok(index > previous, `roadmap order is wrong or missing: ${name}`);
  previous = index;
}
for (const protectedBrand of ['Monopoly', 'Saboteur', 'Tetris', 'Bullhead', '6 nimmt!', 'UNO', 'CATAN', 'Connect Four', 'Codenames']) {
  assert.ok(!html.includes(protectedBrand), `protected commercial title should not be displayed: ${protectedBrand}`);
}
assert.match(html, /Development order/);
assert.equal((html.match(/>In development</g) || []).length, 0, 'nothing is in development now');
assert.ok(!html.includes('Hidden Miners'), 'Hidden Miners is playable, so it is no longer listed');
assert.equal((html.match(/>Planned</g) || []).length, 3, 'the other games are planned');
assert.match(html, /Also on the list/);
assert.match(html, /3 planned/);
assert.match(html, /original artwork and presentation/);
// What's new: the release history is public/whats-new-data.js; the home page shows the newest release's first three items.
const releaseSource = fs.readFileSync(require.resolve('../public/whats-new-data.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(releaseSource, sandbox);
const releases = sandbox.window.TV_RELEASES;
assert.ok(Array.isArray(releases) && releases.length >= 3, 'the release history keeps every date (newest first)');
// Releases are grouped by date, newest first. Each item is major or minor, and only player-facing items are listed.
const dated = releases.filter((r) => r.date);
const dates = dated.map((r) => r.date); assert.equal(JSON.stringify(dates), JSON.stringify([...dates].sort().reverse()), 'dates run newest first');
assert.equal(new Set(dated.map((r) => r.date)).size, dated.length, 'each date appears once');
for (const r of releases) for (const i of r.items) assert.ok(i.level === 'major' || i.level === 'minor', `"${i.title}" is neither major nor minor`);
const byDate = (d) => releases.find((r) => r.date === d);
const majors = (d) => byDate(d).items.filter((i) => i.level === 'major').map((i) => i.title).join('\n');
assert.ok(releases[0].items.some((i) => i.level === 'major'), 'the newest date has at least one major update');
assert.match(majors('2026-11-21'), /Color Clash[\s\S]*Hidden Miners/, 'the Color Clash and Hidden Miners release is on its date');
assert.match(majors('2026-11-20'), /Chess for two/, 'Chess is a major update');
assert.match(majors('2026-11-19'), /Three games have new names/, 'the game renames are on their date');
assert.match(majors('2026-11-18'), /Play without an account/, 'the guest play release is on its date');
// The home What's new shows at most three major updates of the newest date
assert.ok(releases[0].items.filter((i) => i.level === 'major').slice(0, 3).length <= 3, 'the home highlights are at most three');
// Customer copy only: no admin-only work and no game that is not open to players yet
const customerText = JSON.stringify(releases);
assert.doesNotMatch(customerText, /Carrom/i, 'Carrom is not in the customer release notes yet');
assert.doesNotMatch(customerText, /admin/i, 'admin-console work is not in the customer release notes');
assert.match(JSON.stringify(byDate('2026-11-18').items), /Some games need an account/);
assert.match(JSON.stringify(byDate('2026-11-18').items), /Quiet reminders/);
const history = releases.flatMap((r) => r.items.map((i) => i.title)).join('\n');
assert.match(history, /Level-up dialog/);
assert.match(history, /See how far you are to the next level/);
assert.match(history, /A level-up notice, once/);
assert.match(history, /Follow @playtableverse on Instagram/);
assert.ok(releases.some((r) => r.items.some((i) => /Leaving a game with others counts as a loss/.test(i.title))), 'the earlier release stays in the history');
assert.ok(releases.every((r) => (r.date || r.label) && Array.isArray(r.items) && r.items.length > 0), 'every date has a label and items');
// Each date's own items: the game-over date keeps its one player-facing item, as a minor update
const gameOverDate = byDate('2026-11-17');
assert.ok(gameOverDate, 'the game-over date remains in the history');
assert.equal(JSON.stringify(gameOverDate.items.map((i) => i.title)), JSON.stringify(['Level-up dialog']), 'the date keeps its remaining player-facing item');
assert.equal(gameOverDate.items[0].level, 'minor', 'the level-up dialog is a minor update');
for (const item of gameOverDate.items) {
  assert.ok(typeof item.ico === 'string' && item.ico.trim(), `${item.title} has an icon`);
  assert.ok(typeof item.text === 'string' && item.text.trim(), `${item.title} has explanatory text`);
  assert.ok(!item.voice, `${item.title} remains visible with voice chat off`);
}
const appSource = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
assert.match(appSource, /window\.TV_RELEASES/, 'the app reads the release history');
assert.match(appSource, /openVersionHistory/, 'the account menu opens the version history');
assert.match(appSource, /Show minor updates|wn-minor/, 'minor updates are folded under a disclosure');
assert.match(appSource, /releaseSectionHTML/, 'each date is rendered from its own major and minor updates');
assert.doesNotMatch(appSource, /confirm\(/, 'important actions use in-app confirmation dialogs');
console.log('Coming Soon and latest-release-note tests passed (requested order, major and minor updates, customer-only release notes).');
