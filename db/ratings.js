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
const { rankRows, MIN_RATED_GAMES, BOARD_LIMIT } = require('../lib/ratingBoard');

const CHUNK = 500;
const LOCK_KEY = 727275; // distinct from the migration lock (727274)

async function loadMatches(client = db) {
  const { rows } = await client.query(
    `SELECT m.id, m.game_id, m.match_key, m.finished_at, m.completed,
            mp.player_id, mp.seat, mp.is_bot, mp.left_early, mp.forfeit, mp.is_winner, mp.is_draw, mp.place, mp.score
       FROM matches m
       JOIN match_participants mp ON mp.match_id = m.id
      ORDER BY m.finished_at, m.id, mp.seat`,
  );
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, { id: r.id, gameId: r.game_id, matchKey: r.match_key, finishedAt: r.finished_at, completed: r.completed, participants: [] });
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
async function computeRatings(client = db) {
  const matches = await loadMatches(client);
  const since = await forfeitRecordedSince(client);
  const { results, ratings } = replay(matches, { forfeitRecordedSince: since, teamsRecorded: false });
  return { matchesRead: matches.length, forfeitsRecordedSince: since, results, ratings, report: report(results) };
}

/** Replaces the rating tables with the computed result, in one transaction. */
async function rebuildRatings() {
  return db.withTransaction(async (client) => {
    // The lock is taken before the history is read, so a match committed by another rebuild's window cannot be missed.
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const { results, ratings } = await computeRatings(client);
    const events = results.flatMap((r) => r.events.map((e) => ({ ...e, matchId: r.id, gameId: r.gameId })));
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
    return { matches: results.length, ratings: ratings.length, events: events.length };
  });
}

/**
 * The people on one rating board: opted in to the boards (the same switch as the weekly board), with at least the minimum
 * rated games in this scope. `scope` is 'lifetime' or 'YYYY-MM'. Read only.
 */
async function ratingBoard({ gameId, scope, limit = BOARD_LIMIT }) {
  const { rows } = await db.query(
    `SELECT p.username, p.display_name, pr.rating, pr.rated_games
       FROM player_ratings pr
       JOIN players p ON p.id = pr.player_id AND p.leaderboard_opt_in
      WHERE pr.game_id = $1 AND pr.scope = $2 AND pr.rated_games >= $3
      ORDER BY pr.rating DESC, p.username ASC
      LIMIT $4`,
    [String(gameId).slice(0, 40), String(scope).slice(0, 16), MIN_RATED_GAMES, limit],
  );
  return rankRows(rows.map((r) => ({ username: r.username, displayName: r.display_name, rating: r.rating, ratedGames: r.rated_games })), { minRated: MIN_RATED_GAMES, limit });
}

/** One player's own rating for one game and scope, shown to that player whether or not they are on the boards. Read only. */
async function ratingOwn({ playerId, gameId, scope }) {
  const { rows } = await db.query(
    "SELECT rating, rated_games FROM player_ratings WHERE player_id = $1 AND game_id = $2 AND scope = $3",
    [playerId, String(gameId).slice(0, 40), String(scope).slice(0, 16)],
  );
  if (!rows[0]) return null;
  return { rating: rows[0].rating, ratedGames: rows[0].rated_games };
}

/** The live switch: ratings are rebuilt after each finished match only when RATINGS_LIVE=1 (off by default). */
function liveEnabled(env = process.env) {
  return env.RATINGS_LIVE === '1';
}

let rebuildQueue = Promise.resolve(true); // rebuilds run one after another, never at the same time; resolves true when settled ok

/**
 * Queues a rebuild after a match has been committed. It never blocks or fails the game: errors are logged. Called only when
 * liveEnabled() is true. ratingsSettled() waits for the queue (used by the game-over answer, so it sees the new ratings).
 */
// A rebuild that is queued but has not started yet. It reads every committed match when it starts, so a match committed
// before that moment is covered by it: a second queued rebuild would only repeat the same work.
let rebuildWaiting = null;
function scheduleLiveRebuild() {
  if (rebuildWaiting) return;
  const job = rebuildQueue.then(async () => {
    rebuildWaiting = null; // started: a match committed from now on needs a rebuild of its own
    try {
      await rebuildRatings();
      return true;
    } catch (err) {
      createLogger({ component: 'ratings' }).error('ratings.rebuild_failed', { err });
      return false;
    }
  });
  rebuildWaiting = job;
  rebuildQueue = job;
}

/** Resolves true when the latest queued rebuild succeeded, false when it failed (the stored ratings may then be stale). */
function ratingsSettled() {
  return rebuildQueue;
}

/**
 * The numbers the game-over screen shows for each player of one saved match: the change in this match, the monthly rating
 * and its change, and the lifetime rating. Returns null when the match is not stored under that key.
 */
async function ratingsForMatch({ matchKey, gameId, playerIds }) {
  if (!matchKey || !playerIds.length) return null;
  const m = await db.query(
    "SELECT id, rated, unrated_reason, to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month FROM matches WHERE match_key = $1",
    [matchKey],
  );
  if (!m.rows.length) return null;
  const { id: matchId, rated, unrated_reason: reason, month } = m.rows[0];
  // the two lookups do not depend on each other, so they run together (one round trip each, not one after the other)
  const [ev, cur] = await Promise.all([
    db.query(
      'SELECT player_id, scope, delta FROM rating_events WHERE match_id = $1 AND game_id = $2 AND player_id = ANY($3::uuid[])',
      [matchId, gameId, playerIds],
    ),
    db.query(
      'SELECT player_id, scope, rating FROM player_ratings WHERE game_id = $1 AND player_id = ANY($2::uuid[]) AND scope IN (\'lifetime\', $3)',
      [gameId, playerIds, month],
    ),
  ]);
  const out = {};
  for (const id of playerIds) out[id] = { rated: Boolean(rated), reason: reason || null, matchDelta: null, monthDelta: null, monthRating: null, lifetimeRating: null };
  for (const e of ev.rows) {
    const o = out[e.player_id];
    if (!o) continue;
    if (e.scope === 'lifetime') o.matchDelta = Number(e.delta);
    else o.monthDelta = Number(e.delta);
  }
  for (const c of cur.rows) {
    const o = out[c.player_id];
    if (!o) continue;
    if (c.scope === 'lifetime') o.lifetimeRating = Number(c.rating);
    else o.monthRating = Number(c.rating);
  }
  return out;
}

module.exports = { computeRatings, rebuildRatings, liveEnabled, scheduleLiveRebuild, ratingsSettled, ratingsForMatch, ratingBoard, ratingOwn, loadMatches, forfeitRecordedSince, LOCK_KEY };
