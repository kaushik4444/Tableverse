'use strict';
/**
 * Database side of the skill ratings (design/scoring-skill-ratings.md). The rules are in lib/ratingReplay.js; this file only
 * reads the finished matches, replays them, and writes the result.
 *
 * rebuildRatings() replaces player_ratings and rating_events completely, in one transaction that holds an advisory lock,
 * so two rebuilds cannot interleave. It is deterministic, so running it again gives the same result. It reads the whole
 * history each time: fine for the friends beta, and the reason the live switch (RATINGS_LIVE) is off by default.
 */
const db = require('./pool');
const { replay, report } = require('../lib/ratingReplay');
const { createLogger } = require('../lib/log');

const CHUNK = 500;
const LOCK_KEY = 727275; // distinct from the migration lock (727274)

async function loadMatches(client = db) {
  const { rows } = await client.query(
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
async function forfeitRecordedSince(client = db) {
  const { rows } = await client.query("SELECT applied_at FROM schema_migrations WHERE version = '024_match_forfeits.sql'");
  return rows[0] ? rows[0].applied_at : null;
}

async function insertChunks(client, sql, rowsOf, items) {
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const params = [];
    const tuples = slice.map((item) => {
      const marks = rowsOf(item).map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${marks.join(', ')})`;
    });
    await client.query(sql.replace('__VALUES__', tuples.join(', ')), params);
  }
}

/** Computes the ratings from the stored matches. Read only. Returns { results, ratings, rep }. */
async function computeRatings() {
  const matches = await loadMatches();
  const since = await forfeitRecordedSince();
  const { results, ratings } = replay(matches, { forfeitRecordedSince: since, teamsRecorded: false });
  return { matchesRead: matches.length, forfeitsRecordedSince: since, results, ratings, report: report(results) };
}

/** Replaces the rating tables with the computed result, in one transaction. */
async function rebuildRatings() {
  const { results, ratings } = await computeRatings();
  const events = results.flatMap((r) => r.events.map((e) => ({ ...e, matchId: r.id, gameId: r.gameId })));
  await db.withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
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
  return { matches: results.length, ratings: ratings.length, events: events.length };
}

/** The live switch: ratings are rebuilt after each finished match only when RATINGS_LIVE=1 (off by default). */
function liveEnabled(env = process.env) {
  return env.RATINGS_LIVE === '1';
}

/**
 * Starts a rebuild after a match has been committed. It never blocks or fails the game: errors are logged. Called only when
 * liveEnabled() is true.
 */
function scheduleLiveRebuild() {
  setImmediate(() => {
    rebuildRatings().catch((err) => createLogger({ component: 'ratings' }).error('ratings.rebuild_failed', { err }));
  });
}

module.exports = { computeRatings, rebuildRatings, liveEnabled, scheduleLiveRebuild, loadMatches, forfeitRecordedSince, LOCK_KEY };
