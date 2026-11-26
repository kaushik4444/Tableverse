'use strict';
/**
 * Replays finished matches, in order, into skill ratings (see lib/ratings.js and design/scoring-skill-ratings.md).
 * Pure: no database and no clock. The database job (scripts/ratings-replay.js) reads the matches, calls this, and writes
 * the result; a dry run only reports it.
 *
 * Every match is either rated (with one rating event per rated player and scope) or unrated with a reason. Nothing is
 * estimated: when a rule's input is not in the stored data, the match is unrated, and the dry-run report says why.
 *
 * Input match: { id, gameId, finishedAt, completed, participants: [{ playerId, isBot, leftEarly, forfeit, isWinner,
 *   isDraw, place, score, teamId }] }. A participant with no playerId and not a bot is a guest or a removed account.
 */

const R = require('./ratings');
const SOLO = require('./soloRating');
const { ruleKindOf } = require('./gameSkill');

const DAY_MS = 24 * 60 * 60 * 1000;

// Placing games whose stored score is a checked ranking key (higher is better; ties share a place). Checked against the
// engines: Wizard (points), Stage 10 (stage, then fewer points), Ludo and Snakes & Ladders (placing from a complete finish
// order), Go Fish (books), Take 5 (negated penalty total). Snakes & Ladders breaks ties by seat, so its stored key orders
// tied players instead of sharing a place. Anything else placing is unrated until it is checked.
const SCORE_RANKED = new Set(['wizard', 'stagerummy', 'ludo', 'snakesladders', 'gofish', 'penaltyrows']);
// Placing games that store a final place (migration 025): the place is the ranking key.
const PLACE_RANKED = new Set(['poker', 'propertyrivals']);

// Reasons a match is unrated beyond the eligibility rules (unfinished, too few humans).
const REASON = {
  TEAM: 'team-not-recorded', // teams are not stored per participant before the team columns exist
  COOPERATIVE: 'cooperative-not-verified', // Mind: the table's outcome is not stored in a form that can be checked
  RANKING: 'ranking-key-unverified', // a placing game whose stored score has not been checked as a ranking key
  LEAVE: 'leave-before-forfeit-record', // a leave before forfeits were recorded cannot be told apart from a penalised leave
  LEGACY: 'legacy-no-match-key', // written before results were reported (match_key IS NULL): the winners are unknown
  PAIR_LIMIT: 'pair-limit', // every pair in the match already had too many matches in the last 24 hours
};

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The rule check on top of eligibility. Returns a reason string, or null when the match can be replayed. */
function ruleReason(m, options) {
  if (!m.matchKey) return REASON.LEGACY;
  const { family } = R.gameRule(m.gameId);
  if (family === 'team' && !options.teamsRecorded) return REASON.TEAM;
  if (family === 'cooperative') return REASON.COOPERATIVE;
  const kind = ruleKindOf(m.gameId);
  if (kind === 'placing' && !SCORE_RANKED.has(m.gameId) && !PLACE_RANKED.has(m.gameId)) return REASON.RANKING;
  // A game that ranks by place needs a stored place for every player who is still in the match (a forfeit is a loss anyway).
  if (PLACE_RANKED.has(m.gameId) && m.participants.some((p) => !p.isBot && !p.forfeit && !(p.leftEarly) && !Number.isFinite(p.place))) {
    return REASON.RANKING;
  }
  // A leave that is not a forfeit is only trustworthy once forfeits were recorded (migration 024). Before that, a leave
  // may have been a penalised one stored as a plain leave, so the match cannot be replayed.
  const finishedMs = new Date(m.finishedAt).getTime();
  const forfeitsKnownFrom = options.forfeitRecordedSince ? new Date(options.forfeitRecordedSince).getTime() : Infinity;
  if (finishedMs < forfeitsKnownFrom && m.participants.some((p) => p.leftEarly && !p.forfeit)) return REASON.LEAVE;
  return null;
}

/** A participant's value for the rule of its game: higher is better, a penalised leave is -Infinity. */
function valueFor(gameId, p) {
  if (ruleKindOf(gameId) === 'placing' && PLACE_RANKED.has(gameId) && Number.isFinite(p.place)) {
    return R.valueOf(p, { byPlace: true });
  }
  if (ruleKindOf(gameId) === 'placing') {
    if (p.leftEarly && p.forfeit) return -Infinity;
    return Number(p.score) || 0;
  }
  return R.valueOf(p);
}

/**
 * Scales one scope's changes so that no player moves more than the daily cap, using one factor for the whole match. A single
 * factor keeps the match zero-sum (capping each player on its own would not). `allowed(playerId, delta)` is the change the
 * cap lets through for that player; the factor is the smallest allowed/requested ratio.
 */
function capToDay(deltas, allowed) {
  let factor = 1;
  for (const [playerId, delta] of Object.entries(deltas)) {
    if (!delta) continue;
    factor = Math.min(factor, allowed(playerId, delta) / delta);
  }
  if (factor >= 1) return deltas;
  const out = {};
  for (const [playerId, delta] of Object.entries(deltas)) out[playerId] = delta * Math.max(0, factor);
  return out;
}

/**
 * Replays `matches` in order: by finishedAt, then id, so the input order does not matter.
 * options: { forfeitRecordedSince (ISO date from migration 024's applied_at), teamsRecorded (false until team columns exist) }.
 * Returns { results: [{ id, gameId, finishedAt, rated, reason, events }], ratings: [{ playerId, gameId, scope, rating, ratedGames }] }.
 * An event is { playerId, scope, delta, before, after }; scope is 'lifetime' or 'YYYY-MM'.
 */
function replay(matches, options = {}) {
  const ordered = [...matches].sort(
    (a, b) => new Date(a.finishedAt).getTime() - new Date(b.finishedAt).getTime() || String(a.id).localeCompare(String(b.id)),
  );
  const state = new Map(); // `${playerId}|${gameId}|${scope}` -> { rating, ratedGames }
  // options.seed starts the state where a window of history begins (see seedForWindow); a full replay starts at START
  for (const s of options.seed || []) state.set(`${s.playerId}|${s.gameId}|${s.scope}`, { rating: s.rating, ratedGames: s.ratedGames });
  const dayTotal = new Map(); // `${playerId}|${gameId}|${scope}|${day}` -> signed sum of changes, for the daily cap
  const pairTimes = new Map(); // `${gameId}|${a}|${b}` -> finish times (ms) of matches within the last 24 hours
  const results = [];
  // options.dayTotals and options.pairTimes carry the same two maps from before a window (see seedDayTotals and pairHistory)
  for (const d of options.dayTotals || []) dayTotal.set(d.key, d.sum);
  for (const p of options.pairTimes || []) pairTimes.set(p.key, [...p.times]);

  const stateOf = (playerId, gameId, scope) => {
    const key = `${playerId}|${gameId}|${scope}`;
    if (!state.has(key)) state.set(key, { rating: R.START, ratedGames: 0 });
    return state.get(key);
  };

  for (const m of ordered) {
    const finishedMs = new Date(m.finishedAt).getTime();
    // A solo game (one seat) is rated against the par rating in its own scope, and moves no other player.
    if (SOLO.appliesTo(m)) {
      const s = SOLO.soloResult(m);
      if (!s.rated) {
        results.push({ id: m.id, gameId: m.gameId, finishedAt: m.finishedAt, rated: false, reason: s.reason, events: [] });
        continue;
      }
      const st = stateOf(s.playerId, m.gameId, s.scope);
      const before = st.rating;
      const delta = SOLO.soloDelta(before, s.outcome);
      st.rating = before + delta;
      st.ratedGames += 1;
      const event = { playerId: s.playerId, scope: s.scope, delta, before, after: st.rating };
      results.push({ id: m.id, gameId: m.gameId, finishedAt: m.finishedAt, rated: true, reason: null, events: [event] });
      continue;
    }
    const parts = m.participants.map((p) => ({
      ...p,
      isGuest: !p.isBot && !p.playerId,
      playerId: p.playerId || `guest:${p.seat ?? ''}`,
    }));
    const elig = R.eligibility(parts, { finished: m.completed !== false });
    const reason = elig.rated ? ruleReason(m, options) : elig.reason;
    if (!elig.rated || reason) {
      results.push({ id: m.id, gameId: m.gameId, finishedAt: m.finishedAt, rated: false, reason: reason || elig.reason, events: [] });
      continue;
    }

    // Pair limit: how many matches this pair already had in the last 24 hours, counted before this match.
    const pairKey = (a, b) => `${m.gameId}|${[a, b].sort().join('|')}`;
    const priorCount = (a, b) => (pairTimes.get(pairKey(a, b)) || []).filter((t) => finishedMs - t < DAY_MS).length;
    const pairFactorTable = new Map();
    for (const p of elig.players) {
      for (const q of elig.players) {
        if (p.playerId >= q.playerId) continue;
        pairFactorTable.set(pairKey(p.playerId, q.playerId), R.pairMultiplier(priorCount(p.playerId, q.playerId)));
      }
    }
    const pairFactor = (p, q) => pairFactorTable.get(pairKey(p.playerId, q.playerId)) ?? 1;
    // Every pair has used up the limit: the match is not rated (it still counts towards the limit, as a played match does).
    const allSuppressed = [...pairFactorTable.values()].every((f) => f === 0);

    const recordPairs = () => {
      for (const p of elig.players) {
        for (const q of elig.players) {
          if (p.playerId >= q.playerId) continue;
          const k = pairKey(p.playerId, q.playerId);
          const times = (pairTimes.get(k) || []).filter((t) => finishedMs - t < DAY_MS);
          times.push(finishedMs);
          pairTimes.set(k, times);
        }
      }
    };

    if (allSuppressed) {
      recordPairs();
      results.push({ id: m.id, gameId: m.gameId, finishedAt: m.finishedAt, rated: false, reason: REASON.PAIR_LIMIT, events: [] });
      continue;
    }

    const events = [];
    const day = utcDay(finishedMs);
    for (const scope of ['lifetime', R.monthKey(finishedMs)]) {
      const players = elig.players.map((p) => {
        const s = stateOf(p.playerId, m.gameId, scope);
        return { playerId: p.playerId, teamId: p.teamId, rating: s.rating, ratedGames: s.ratedGames, value: valueFor(m.gameId, p) };
      });
      const requested = R.matchDeltas(m.gameId, players, { pairFactor });
      const deltas = capToDay(requested, (playerId) => {
        const used = dayTotal.get(`${playerId}|${m.gameId}|${scope}|${day}`) || 0;
        return R.cappedDelta(used, requested[playerId]);
      });
      for (const p of players) {
        const s = stateOf(p.playerId, m.gameId, scope);
        const capKey = `${p.playerId}|${m.gameId}|${scope}|${day}`;
        const before = s.rating;
        const delta = deltas[p.playerId] || 0;
        dayTotal.set(capKey, (dayTotal.get(capKey) || 0) + delta);
        s.rating = before + delta;
        s.ratedGames += 1;
        events.push({ playerId: p.playerId, scope, delta, before, after: s.rating });
      }
    }

    // Record this match for the pair limit, and forget pairs' matches older than 24 hours.
    recordPairs();

    results.push({ id: m.id, gameId: m.gameId, finishedAt: m.finishedAt, rated: true, reason: null, events });
  }

  const ratings = [...state.entries()].map(([key, s]) => {
    const [playerId, gameId, scope] = key.split('|');
    return { playerId, gameId, scope, rating: s.rating, ratedGames: s.ratedGames };
  });
  return { results, ratings };
}

/**
 * The dry-run report: per game, how many matches can be replayed, and why the others cannot. Counts only, no ratings.
 */
function report(results) {
  const byGame = {};
  for (const r of results) {
    const g = (byGame[r.gameId] ||= { matches: 0, rated: 0, unrated: 0, reasons: {} });
    g.matches += 1;
    if (r.rated) g.rated += 1;
    else {
      g.unrated += 1;
      g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
    }
  }
  return byGame;
}

/**
 * The state a window of history starts from, read from the stored ledger, so that replaying only the window gives the same
 * numbers as replaying everything. Only the windowed matches are needed; everything before the window is summed up here.
 *   current:      stored ratings now (player, game, scope, rating, ratedGames). After the last rebuild they include every match.
 *   windowEvents: ledger rows of matches at or after the window start ({ playerId, gameId, scope, before, finishedMs, matchId }).
 *   priorCounts:  how many ledger rows each player, game and scope has before the window start ({ playerId, gameId, scope, count }).
 * A key that has ledger rows in the window starts at the rating before its first window row; a key without any stays as stored.
 */
function seedForWindow({ current = [], windowEvents = [], priorCounts = [] }) {
  const key = (x) => `${x.playerId}|${x.gameId}|${x.scope}`;
  const seed = new Map();
  for (const c of current) seed.set(key(c), { playerId: c.playerId, gameId: c.gameId, scope: c.scope, rating: c.rating, ratedGames: c.ratedGames });
  const prior = new Map(priorCounts.map((p) => [key(p), p.count]));
  const first = new Map();
  for (const e of windowEvents) {
    const k = key(e);
    const cur = first.get(k);
    if (!cur || e.finishedMs < cur.finishedMs || (e.finishedMs === cur.finishedMs && String(e.matchId) < String(cur.matchId))) first.set(k, e);
  }
  for (const [k, e] of first) seed.set(k, { playerId: e.playerId, gameId: e.gameId, scope: e.scope, rating: e.before, ratedGames: prior.get(k) || 0 });
  return [...seed.values()];
}

/** The daily-cap totals a window needs from the matches before it: signed sums per player, game, scope and UTC day, added in
 *  finish order (the same order the replay adds them, so the sums are the same numbers). events: [{ playerId, gameId, scope, delta, finishedMs, matchId }]. */
function seedDayTotals(events) {
  const sorted = [...events].sort((a, b) => a.finishedMs - b.finishedMs || String(a.matchId).localeCompare(String(b.matchId)));
  const sums = new Map();
  for (const e of sorted) {
    const k = `${e.playerId}|${e.gameId}|${e.scope}|${utcDay(e.finishedMs)}`;
    sums.set(k, (sums.get(k) || 0) + e.delta);
  }
  return [...sums].map(([key, sum]) => ({ key, sum }));
}

/** The pair-limit history a window needs from the matches just before it: the finish times of every pair that the replay
 *  recorded (a rated match, or one unrated only by the pair limit). priorMatches: [{ id, gameId, finishedAt, completed, rated,
 *  reason, participants }], stored values. Ratings are not needed for this. */
function pairHistory(priorMatches) {
  const ordered = [...priorMatches].sort((a, b) => new Date(a.finishedAt).getTime() - new Date(b.finishedAt).getTime() || String(a.id).localeCompare(String(b.id)));
  const times = new Map();
  for (const m of ordered) {
    if (!m.rated && m.reason !== REASON.PAIR_LIMIT) continue;
    const parts = m.participants.map((p) => ({ ...p, isGuest: !p.isBot && !p.playerId, playerId: p.playerId || `guest:${p.seat ?? ''}` }));
    const elig = R.eligibility(parts, { finished: m.completed !== false });
    if (!elig.rated) continue;
    const finishedMs = new Date(m.finishedAt).getTime();
    for (const p of elig.players) {
      for (const q of elig.players) {
        if (p.playerId >= q.playerId) continue;
        const k = `${m.gameId}|${[p.playerId, q.playerId].sort().join('|')}`;
        const list = times.get(k) || [];
        list.push(finishedMs);
        times.set(k, list);
      }
    }
  }
  return [...times].map(([key, list]) => ({ key, times: list }));
}

module.exports = { replay, report, seedForWindow, seedDayTotals, pairHistory, REASON, SCORE_RANKED, PLACE_RANKED };
