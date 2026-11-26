'use strict';
require('./helpers/env');
// The skill ratings on a REAL PostgreSQL (a throw-away database from tests/helpers/testdb.js). Runs only with TEST_DATABASE_URL.
// Covers the rebuild (zero-sum, idempotent, unrated reasons), the rating board (opted-in people, the 5-game minimum) and the
// game-over lookup.
const assert = require('node:assert/strict');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  process.env.DATABASE_URL = t.url;
  let x = null;
  let db = null;
  try {
    await require('../db/migrate').migrate();
    x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    db = require('../db/pool');
    const ratings = require('../db/ratings');

    // players: A and B are on the boards, C is on the boards but plays too little, D is off the boards
    const [A, B, C, D] = await Promise.all([
      q("INSERT INTO players (username, display_name, leaderboard_opt_in) VALUES ('ann','Ann',TRUE) RETURNING id"),
      q("INSERT INTO players (username, display_name, leaderboard_opt_in) VALUES ('bob','Bo',FALSE) RETURNING id"),
      q("INSERT INTO players (username, display_name, leaderboard_opt_in) VALUES ('cyn','Cy',TRUE) RETURNING id"),
      q("INSERT INTO players (username, display_name, leaderboard_opt_in) VALUES ('dia','Di',FALSE) RETURNING id"),
    ]).then((rows) => rows.map((r) => r[0].id));

    // seven chess matches between A and B, one hour apart (A wins four, B wins three)
    const matchKeys = [];
    for (let i = 0; i < 7; i++) {
      const aWins = i % 2 === 0 || i === 6;
      const [m] = await q(
        `INSERT INTO matches (room_code, game_id, seats, match_key, started_at, finished_at, completed)
         VALUES ($1, 'chess', 2, gen_random_uuid(), NOW() - INTERVAL '1 day' + ($2 * INTERVAL '1 hour'), NOW() - INTERVAL '1 day' + ($2 * INTERVAL '1 hour'), TRUE)
         RETURNING id, match_key`,
        ['T' + i, i],
      );
      matchKeys.push(m.match_key);
      await q(`INSERT INTO match_participants (match_id, player_id, player_name, seat, is_winner) VALUES ($1, $2, 'Ann', 0, $3), ($1, $4, 'Bo', 1, $5)`,
        [m.id, A, aWins, B, !aWins]);
    }
    // three matches for C against D (too few games for the board), and one bot match that must be unrated
    for (let i = 0; i < 3; i++) {
      const [m] = await q(`INSERT INTO matches (room_code, game_id, seats, match_key, started_at, finished_at, completed)
        VALUES ($1, 'chess', 2, gen_random_uuid(), NOW() - INTERVAL '2 days' + ($2 * INTERVAL '1 hour'), NOW() - INTERVAL '2 days' + ($2 * INTERVAL '1 hour'), TRUE) RETURNING id`, ['U' + i, i]);
      await q(`INSERT INTO match_participants (match_id, player_id, player_name, seat, is_winner) VALUES ($1, $2, 'Cy', 0, TRUE), ($1, $3, 'Di', 1, FALSE)`, [m.id, C, D]);
    }
    const [bot] = await q(`INSERT INTO matches (room_code, game_id, seats, match_key, started_at, finished_at, completed)
      VALUES ('BOT1', 'chess', 2, gen_random_uuid(), NOW(), NOW(), TRUE) RETURNING id`);
    await q(`INSERT INTO match_participants (match_id, player_id, player_name, seat, is_winner, is_bot) VALUES ($1, $2, 'Ann', 0, TRUE, FALSE), ($1, NULL, 'Robot', 1, FALSE, TRUE)`, [bot.id, A]);

    await test('the rebuild rates the matches, keeps every change zero-sum, and leaves a one-human bot match unrated', async () => {
      const done = await ratings.rebuildRatings();
      assert.equal(done.matches, 11);
      const sum = (await q("SELECT COALESCE(SUM(delta), 0) AS s FROM rating_events WHERE scope = 'lifetime'"))[0].s;
      assert.ok(Math.abs(Number(sum)) < 0.5, `lifetime changes add up to 0 (got ${sum})`);
      const b = (await q('SELECT rated, unrated_reason FROM matches WHERE id = $1', [bot.id]))[0];
      assert.equal(b.rated, false);
      assert.equal(b.unrated_reason, 'too-few-players', 'a bot is not counted, so one human left is not enough to rate');
    });

    await test('the rebuild is idempotent: running it again gives the same ratings', async () => {
      const before = await q('SELECT player_id, game_id, scope, rating, rated_games FROM player_ratings ORDER BY 1, 2, 3');
      await ratings.rebuildRatings();
      const after = await q('SELECT player_id, game_id, scope, rating, rated_games FROM player_ratings ORDER BY 1, 2, 3');
      assert.deepEqual(after, before);
    });

    await test('the lifetime board names only opted-in people with at least 5 rated games', async () => {
      const board = await ratings.ratingBoard({ gameId: 'chess', scope: 'lifetime' });
      assert.deepEqual(board.map((r) => r.username), ['ann'], 'Bo and Di opted out; Cy has only 3 games');
      // Seven matches in one day: the 6th and 7th are over the pair limit (24 hours) and unrated, so Ann has five rated games.
      assert.equal(board[0].ratedGames, 5, 'Ann has five rated games against Bo: the pair limit leaves the 6th and 7th unrated, and the bot match does not count');
    });

    await test('the game-over lookup returns each player for one match', async () => {
      const out = await ratings.ratingsForMatch({ matchKey: matchKeys[0], gameId: 'chess', playerIds: [A, B] });
      assert.ok(out, 'the match is found by its key');
      assert.equal(out[A].rated, true);
      assert.equal(typeof out[A].lifetimeRating, 'number');
      assert.equal(typeof out[A].matchDelta, 'number');
    });

    const snapshot = async () => ({
      ratings: await q('SELECT player_id, game_id, scope, rating::text AS rating, rated_games FROM player_ratings ORDER BY 1, 2, 3'),
      events: await q('SELECT match_id, player_id, scope, delta::text AS delta, rating_before::text AS before, rating_after::text AS after FROM rating_events ORDER BY 1, 2, 3'),
      matches: await q('SELECT id, rated, unrated_reason FROM matches ORDER BY id'),
    });

    await test('an incremental rebuild after a new match gives exactly the full rebuild (ratings and ledger)', async () => {
      // the stored state after a full rebuild, then one new match, then incremental: compare with a full rebuild of the same data
      await ratings.rebuildRatings();
      const [later] = await q(
        `INSERT INTO matches (room_code, game_id, seats, match_key, started_at, finished_at, completed)
         VALUES ('LATE1', 'chess', 2, gen_random_uuid(), NOW() + INTERVAL '2 hours', NOW() + INTERVAL '2 hours', TRUE) RETURNING id`,
      );
      await q(`INSERT INTO match_participants (match_id, player_id, player_name, seat, is_winner) VALUES ($1, $2, 'Ann', 0, TRUE), ($1, $3, 'Bo', 1, FALSE)`, [later.id, A, B]);
      const done = await ratings.rebuildRatingsIncremental();
      assert.equal(done.mode, 'incremental', 'the new match is replayed on its own');
      assert.equal(done.matches, 1);
      const incremental = await snapshot();
      await ratings.rebuildRatings();
      const full = await snapshot();
      assert.deepEqual(incremental, full, 'the stored ratings, ledger rows and rated flags are identical');
    });

    await test('deleting an account invalidates ratings from matches older than the incremental window', async () => {
      const removed = await db.withTransaction((client) => require('../db/account').removePlayerTx(client, B));
      assert.equal(removed.matchesKept, 8);
      const [fresh] = await q(
        `INSERT INTO matches (room_code, game_id, seats, match_key, started_at, finished_at, completed)
         VALUES ('LATE2', 'chess', 2, gen_random_uuid(), NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days', TRUE) RETURNING id`,
      );
      await q(`INSERT INTO match_participants (match_id, player_id, player_name, seat, is_winner) VALUES ($1, $2, 'Ann', 0, TRUE), ($1, $3, 'Cy', 1, FALSE)`, [fresh.id, A, C]);
      assert.equal((await ratings.rebuildRatingsIncremental()).mode, 'full');
      assert.equal((await ratings.ratingOwn({ playerId: A, gameId: 'chess', scope: 'lifetime' })).ratedGames, 1);
      const repaired = await snapshot();
      await ratings.rebuildRatings();
      assert.deepEqual(await snapshot(), repaired, 'the old ledger entries and their effects are removed');
      assert.equal((await ratings.rebuildRatingsIncremental()).mode, 'incremental', 'anonymized matches no longer force full rebuilds');
    });

    console.log(`\n${passed} rating PostgreSQL tests passed`);
  } finally {
    if (db && db.close) await db.close().catch(() => {});
    await t.drop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
