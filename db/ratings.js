'use strict';
/**
 * Database side of the skill ratings (design/scoring-skill-ratings.md). The rules are in lib/ratingReplay.js; this file only
 * reads the finished matches, replays them, and writes the result.
 *
 * rebuildRatings() replaces player_ratings and rating_events completely, in one transaction that holds an advisory lock,
 * so two rebuilds cannot interleave. It is deterministic, so running it again gives the same result.
 * rebuildRatingsIncremental() (used after each finished match when RATINGS_LIVE=1) replays only the matches written since the
 * last rebuild, from the stored state, and checks that against the stored history first. It falls back to a full rebuild when
 * it cannot be sure. Both give the same numbers (tests/ratings-incremental.test.js).
 */
const db = require('./pool');
const { replay, report, seedForWindow, seedDayTotals, pairHistory, REASON } = require('../lib/ratingReplay');
const { createLogger } = require('../lib/log');
const { rankRows, MIN_RATED_GAMES, BOARD_LIMIT } = require('../lib/ratingBoard');

const CHUNK = 500;
const LOCK_KEY = 727275; // distinct from the migration lock (727274)

const DAY_MS = 24 * 60 * 60 * 1000;

/** Finished matches with their participants, in replay order. `since` (inclusive) and `before` (exclusive) limit the window. */
async function loadMatches(client = db, { since = null, before = null } = {}) {
  const { rows } = await client.query(
    `SELECT m.id, m.game_id, m.match_key, m.finished_at, m.completed, m.rated, m.unrated_reason, m.rating_processed, m.options,
            mp.player_id, mp.seat, mp.is_bot, mp.left_early, mp.forfeit, mp.is_winner, mp.is_draw, mp.place, mp.score
       FROM matches m
       JOIN match_participants mp ON mp.match_id = m.id
      WHERE ($1::timestamptz IS NULL OR m.finished_at >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR m.finished_at < $2::timestamptz)
      ORDER BY m.finished_at, m.id, mp.seat`,
    [since, before],
  );
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, {
        id: r.id, gameId: r.game_id, matchKey: r.match_key, finishedAt: r.finished_at, completed: r.completed,
        rated: r.rated, reason: r.unrated_reason, options: r.options || {}, participants: [],
        // a match already processed as unrated because of a bot keeps that result: only an explicit replay may change it
        frozen: Boolean(r.rating_processed) && r.rated === false && r.unrated_reason === 'bot',
      });
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

/** Replays the whole history and replaces the rating tables. The caller holds the advisory lock. */
async function fullRebuildInTx(client) {
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
    await client.query('UPDATE matches SET rated = $2, unrated_reason = $3, rating_processed = TRUE WHERE id = $1', [r.id, r.rated, r.reason]);
  }
  return { mode: 'full', matches: results.length, ratings: ratings.length, events: events.length };
}

/** Replaces the rating tables with a full replay, in one transaction. */
async function rebuildRatings() {
  return db.withTransaction(async (client) => {
    // The lock is taken before the history is read, so a match committed by another rebuild's window cannot be missed.
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    return fullRebuildInTx(client);
  });
}

/**
 * Replays only the matches written since the last rebuild, starting from the stored state. Returns null when that cannot be
 * trusted, and the caller then does a full rebuild: nothing has been processed yet, a waiting match is not after the last
 * processed one, or a processed match in the window would not replay to what is stored. Nothing is written before those checks.
 */
async function incrementalInTx(client) {
  // Deletion clears the participant ID and cascades that player's rating rows. Other players' rows may still
  // include the old match, even outside the replay window. Pair-limited matches also contribute to pair history.
  const invalidated = await client.query(
    `SELECT 1 FROM match_participants mp JOIN matches m ON m.id = mp.match_id
      WHERE mp.player_id IS NULL AND NOT mp.is_bot AND m.rating_processed
        AND (m.rated OR m.unrated_reason = $1)
      LIMIT 1`,
    [REASON.PAIR_LIMIT],
  );
  if (invalidated.rows.length) return null;

  const mark = await client.query('SELECT MAX(finished_at) AS at FROM matches WHERE rating_processed');
  if (!mark.rows[0].at) return null;
  const watermark = new Date(mark.rows[0].at).getTime();
  const pending = await client.query('SELECT id, finished_at FROM matches WHERE NOT rating_processed ORDER BY finished_at, id');
  if (!pending.rows.length) return { mode: 'incremental', matches: 0, ratings: 0, events: 0 };
  if (pending.rows.some((r) => new Date(r.finished_at).getTime() <= watermark)) return null;
  const pendingIds = new Set(pending.rows.map((r) => r.id));

  // The window starts a day before the oldest waiting match (the pair limit looks back a day), or at the start of its UTC day
  // (the daily cap), whichever is earlier. Everything before it is summed up in the seeds below.
  const oldest = new Date(pending.rows[0].finished_at).getTime();
  const dayStart = new Date(oldest); dayStart.setUTCHours(0, 0, 0, 0);
  const since = new Date(Math.min(oldest - DAY_MS, dayStart.getTime()));
  const sinceDay = new Date(since); sinceDay.setUTCHours(0, 0, 0, 0);
  const window = await loadMatches(client, { since });
  const players = [...new Set(window.flatMap((m) => m.participants.map((p) => p.playerId)).filter(Boolean))];

  const [current, inWindow, counts, dayRows, prior] = await Promise.all([
    client.query('SELECT player_id, game_id, scope, rating, rated_games FROM player_ratings WHERE player_id = ANY($1::uuid[])', [players]),
    client.query(
      `SELECT e.match_id, e.player_id, e.game_id, e.scope, e.rating_before, m.finished_at
         FROM rating_events e JOIN matches m ON m.id = e.match_id
        WHERE m.finished_at >= $1 AND e.player_id = ANY($2::uuid[])`,
      [since, players],
    ),
    client.query(
      `SELECT e.player_id, e.game_id, e.scope, COUNT(*)::int AS n
         FROM rating_events e JOIN matches m ON m.id = e.match_id
        WHERE m.finished_at < $1 AND e.player_id = ANY($2::uuid[])
        GROUP BY e.player_id, e.game_id, e.scope`,
      [since, players],
    ),
    client.query(
      `SELECT e.match_id, e.player_id, e.game_id, e.scope, e.delta, m.finished_at
         FROM rating_events e JOIN matches m ON m.id = e.match_id
        WHERE m.finished_at >= $1 AND m.finished_at < $2 AND e.player_id = ANY($3::uuid[])`,
      [sinceDay, since, players],
    ),
    loadMatches(client, { since: new Date(since.getTime() - DAY_MS), before: since }),
  ]);

  const seed = {
    state: seedForWindow({
      current: current.rows.map((r) => ({ playerId: r.player_id, gameId: r.game_id, scope: r.scope, rating: Number(r.rating), ratedGames: r.rated_games })),
      windowEvents: inWindow.rows.map((r) => ({ playerId: r.player_id, gameId: r.game_id, scope: r.scope, before: Number(r.rating_before), finishedMs: new Date(r.finished_at).getTime(), matchId: r.match_id })),
      priorCounts: counts.rows.map((r) => ({ playerId: r.player_id, gameId: r.game_id, scope: r.scope, count: r.n })),
    }),
    dayTotals: seedDayTotals(dayRows.rows.map((r) => ({ playerId: r.player_id, gameId: r.game_id, scope: r.scope, delta: Number(r.delta), finishedMs: new Date(r.finished_at).getTime(), matchId: r.match_id }))),
    pairTimes: pairHistory(prior),
  };
  const { results, ratings } = replay(window, { forfeitRecordedSince: await forfeitRecordedSince(client), teamsRecorded: false, seed: seed.state, dayTotals: seed.dayTotals, pairTimes: seed.pairTimes });

  // Self-check: every processed match in the window must replay to exactly what is stored for it. Otherwise the seeds are not
  // trustworthy here, and the full rebuild is the answer.
  const processedIds = window.filter((m) => !pendingIds.has(m.id)).map((m) => m.id);
  const stored = await client.query(
    'SELECT match_id, player_id, scope, delta, rating_before, rating_after FROM rating_events WHERE match_id = ANY($1::uuid[])',
    [processedIds],
  );
  const signature = (events) => events.map((e) => `${e.playerId}|${e.scope}|${String(e.delta)}|${String(e.before)}|${String(e.after)}`).sort().join(';');
  const storedByMatch = new Map();
  for (const r of stored.rows) {
    const list = storedByMatch.get(r.match_id) || [];
    list.push({ playerId: r.player_id, scope: r.scope, delta: Number(r.delta), before: Number(r.rating_before), after: Number(r.rating_after) });
    storedByMatch.set(r.match_id, list);
  }
  const ratedById = new Map(window.map((m) => [m.id, m.rated]));
  for (const r of results) {
    if (pendingIds.has(r.id)) continue;
    if (r.rated !== ratedById.get(r.id) || signature(r.events) !== signature(storedByMatch.get(r.id) || [])) return null;
  }

  const fresh = results.filter((r) => pendingIds.has(r.id));
  const events = fresh.flatMap((r) => r.events.map((e) => ({ ...e, matchId: r.id, gameId: r.gameId })));
  await insertChunks(
    client,
    'INSERT INTO rating_events (match_id, player_id, game_id, scope, delta, rating_before, rating_after) VALUES __VALUES__ ON CONFLICT (match_id, player_id, game_id, scope) DO NOTHING',
    (e) => [e.matchId, e.playerId, e.gameId, e.scope, e.delta, e.before, e.after],
    events,
  );
  await insertChunks(
    client,
    'INSERT INTO player_ratings (player_id, game_id, scope, rating, rated_games) VALUES __VALUES__ ON CONFLICT (player_id, game_id, scope) DO UPDATE SET rating = EXCLUDED.rating, rated_games = EXCLUDED.rated_games, updated_at = NOW()',
    (r) => [r.playerId, r.gameId, r.scope, r.rating, r.ratedGames],
    ratings,
  );
  for (const r of fresh) {
    await client.query('UPDATE matches SET rated = $2, unrated_reason = $3, rating_processed = TRUE WHERE id = $1', [r.id, r.rated, r.reason]);
  }
  return { mode: 'incremental', matches: fresh.length, ratings: ratings.length, events: events.length };
}

/**
 * Brings the rating tables up to date after matches are committed. Incremental when it can be trusted, otherwise a full replay.
 * Both run under the advisory lock, one at a time.
 */
async function rebuildRatingsIncremental() {
  return db.withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const done = await incrementalInTx(client);
    if (done) return done;
    return fullRebuildInTx(client);
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
      const done = await rebuildRatingsIncremental();
      createLogger({ component: 'ratings' }).info('ratings.rebuilt', { mode: done.mode, matches: done.matches });
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

module.exports = { computeRatings, rebuildRatings, rebuildRatingsIncremental, liveEnabled, scheduleLiveRebuild, ratingsSettled, ratingsForMatch, ratingBoard, ratingOwn, loadMatches, forfeitRecordedSince, LOCK_KEY };
