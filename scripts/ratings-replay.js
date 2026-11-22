'use strict';
/**
 * Replays every finished match into skill ratings (design/scoring-skill-ratings.md, step 2 and 3).
 *
 *   node scripts/ratings-replay.js                  dry run: reads the matches, prints the report, writes nothing
 *   node scripts/ratings-replay.js --apply          rebuilds the ratings and the ledger in one transaction
 *
 * --apply also needs RATINGS_REPLAY_CONFIRM=replay-all-matches, so it cannot run by accident. It runs against whatever
 * DATABASE_URL points at: point it at a COPY of the database first, review the report, then run it on production.
 *
 * The rebuild is deterministic and replaces the rating tables completely, so running it twice gives the same result.
 * Take a backup before --apply on production (see the design doc). Once live ratings are written by the app, run a
 * replay only in a maintenance window, because it rewrites the history of every rating.
 */
const db = require('../db/pool');
const { replay, report } = require('../lib/ratingReplay');

const APPLY = process.argv.includes('--apply');
const CHUNK = 500;

async function loadMatches() {
  const { rows } = await db.query(
    `SELECT m.id, m.game_id, m.finished_at, m.completed,
            mp.player_id, mp.seat, mp.is_bot, mp.left_early, mp.forfeit, mp.is_winner, mp.is_draw, mp.place, mp.score
       FROM matches m
       JOIN match_participants mp ON mp.match_id = m.id
      ORDER BY m.finished_at, m.id, mp.seat`,
  );
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, { id: r.id, gameId: r.game_id, finishedAt: r.finished_at, completed: r.completed, participants: [] });
    }
    byId.get(r.id).participants.push({
      playerId: r.player_id, seat: r.seat, isBot: r.is_bot, leftEarly: r.left_early, forfeit: r.forfeit,
      isWinner: r.is_winner, isDraw: r.is_draw, place: r.place, score: r.score,
    });
  }
  return [...byId.values()];
}

/** When forfeits started being recorded (migration 024). Matches before it cannot tell a forfeit from a plain leave. */
async function forfeitRecordedSince() {
  const { rows } = await db.query("SELECT applied_at FROM schema_migrations WHERE version = '024_match_forfeits.sql'");
  return rows[0] ? rows[0].applied_at : null;
}

function printReport(rep, ratingCount) {
  const games = Object.keys(rep).sort();
  for (const g of games) {
    const r = rep[g];
    console.log(`${g.padEnd(16)} matches ${String(r.matches).padStart(6)}  rated ${String(r.rated).padStart(6)}  unrated ${String(r.unrated).padStart(6)}`);
    for (const [reason, n] of Object.entries(r.reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`${' '.repeat(18)}- ${reason}: ${n}`);
    }
  }
  console.log(`ratings that would be written: ${ratingCount}`);
}

async function insertChunks(client, sql, rowsOf, items) {
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const params = [];
    const tuples = slice.map((item) => {
      const values = rowsOf(item);
      const marks = values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${marks.join(', ')})`;
    });
    await client.query(sql.replace('__VALUES__', tuples.join(', ')), params);
  }
}

async function apply(results, ratings) {
  if (process.env.RATINGS_REPLAY_CONFIRM !== 'replay-all-matches') {
    throw new Error('Refusing to apply: set RATINGS_REPLAY_CONFIRM=replay-all-matches after reviewing the dry run.');
  }
  const events = results.flatMap((r) => r.events.map((e) => ({ ...e, matchId: r.id, gameId: r.gameId })));
  await db.withTransaction(async (client) => {
    await client.query('DELETE FROM rating_events');
    await client.query('DELETE FROM player_ratings');
    await insertChunks(
      client,
      'INSERT INTO player_ratings (player_id, game_id, scope, rating, rated_games) VALUES __VALUES__',
      (r) => [r.playerId, r.gameId, r.scope, r.rating, r.ratedGames],
      ratings,
    );
    await insertChunks(
      client,
      'INSERT INTO rating_events (match_id, player_id, game_id, scope, delta, rating_before, rating_after) VALUES __VALUES__ ON CONFLICT (match_id, player_id, game_id, scope) DO NOTHING',
      (e) => [e.matchId, e.playerId, e.gameId, e.scope, e.delta, e.before, e.after],
      events,
    );
    for (const r of results) {
      await client.query('UPDATE matches SET rated = $2, unrated_reason = $3 WHERE id = $1', [r.id, r.rated, r.reason]);
    }
  });
}

async function main() {
  if (!db.hasDatabase()) throw new Error('DATABASE_URL is not set.');
  const matches = await loadMatches();
  const since = await forfeitRecordedSince();
  const { results, ratings } = replay(matches, { forfeitRecordedSince: since, teamsRecorded: false });
  console.log(`matches read: ${matches.length}; forfeits recorded since: ${since ? new Date(since).toISOString() : 'unknown (all leaves unrated)'}`);
  printReport(report(results), ratings.length);
  if (!APPLY) {
    console.log('dry run: nothing was written. Re-run with --apply and RATINGS_REPLAY_CONFIRM=replay-all-matches to write.');
    return;
  }
  await apply(results, ratings);
  console.log('applied: ratings and the ledger were rebuilt.');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(`[ratings-replay] ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}

module.exports = { loadMatches };
