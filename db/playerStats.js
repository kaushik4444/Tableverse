'use strict';
/**
 * Player directory and per-player profile for the admin console (read-only, staff only).
 *
 * Registered accounts only (anonymous guests have no profile), and only fields a moderator needs: the public username and
 * display name, the country the player chose, join and last-seen times, and play figures from finished games. Never an
 * e-mail address, a network address, a token or a chat message. Opening one player's profile is written to the audit log.
 * Bots never count as a player.
 */
const db = require('./pool');

const PAGE = 25;
const ZONES = ['UTC', 'Europe/Berlin', 'Asia/Kolkata'];
const clampZone = (z) => (ZONES.includes(z) ? z : 'UTC');
const page = (p) => Math.max(0, (Math.floor(Number(p)) || 1) - 1);
const like = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const num = (v) => Number(v) || 0;
const round1 = (v) => Math.round(num(v) * 10) / 10;

// Only these orderings exist, so no request text ever reaches the SQL.
const SORTS = {
  seen: 'p.last_seen_at DESC NULLS LAST',
  joined: 'p.created_at DESC',
  games: 's.games DESC',
  wins: 's.wins DESC',
  minutes: 's.minutes DESC',
  leaving: 's.left_early DESC',
};
const clampSort = (s) => (Object.hasOwn(SORTS, s) ? s : 'seen');

// A game has a RATED result for a player only if the player stayed to the end and the match was recorded with results.
// Same rule as the player's own history and stats (db/matches.js): a bot that took over a seat can carry a win on the
// departed player's row, and matches written before results were reported (match_key IS NULL) have unknown winners.
// Neither may count as a win, a draw or a loss. They still count as games played and as games left early.
const RATED = '(NOT mp.left_early AND m.match_key IS NOT NULL)';
const COUNTS = `
  COUNT(*)::int AS games,
  COUNT(*) FILTER (WHERE ${RATED})::int AS rated,
  COUNT(*) FILTER (WHERE ${RATED} AND mp.is_winner)::int AS wins,
  COUNT(*) FILTER (WHERE ${RATED} AND mp.is_draw)::int AS draws,
  COUNT(*) FILTER (WHERE mp.left_early)::int AS left_early,
  COALESCE(SUM(CASE WHEN mp.left_early THEN 0 ELSE EXTRACT(EPOCH FROM (m.finished_at - m.started_at)) END) / 60.0, 0)::float AS minutes`;

// one row per registered player with all-time figures from finished games (a player with no games still gets a row)
const STATS = `
  LEFT JOIN LATERAL (
    SELECT ${COUNTS}, MAX(m.finished_at) AS last_game
      FROM match_participants mp JOIN matches m ON m.id = mp.match_id
     WHERE mp.player_id = p.id AND NOT mp.is_bot
  ) s ON TRUE`;

async function listPlayers({ q = '', sort = 'seen', page: pg = 1 } = {}) {
  const term = String(q || '').trim().slice(0, 40);
  const key = clampSort(sort);
  const args = [];
  let where = 'WHERE p.is_anonymous = FALSE AND p.username IS NOT NULL';
  if (term) { args.push(like(term)); where += ` AND (p.username ILIKE $1 ESCAPE '\\' OR p.display_name ILIKE $1 ESCAPE '\\')`; }
  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM players p ${where}`, args)).rows[0].n;
  const r = await db.query(
    `SELECT p.username, p.display_name, p.country, p.role, p.created_at, p.last_seen_at, p.suspended_at,
            COALESCE(s.games, 0) AS games, COALESCE(s.rated, 0) AS rated, COALESCE(s.wins, 0) AS wins, COALESCE(s.draws, 0) AS draws,
            COALESCE(s.left_early, 0) AS left_early, COALESCE(s.minutes, 0) AS minutes, s.last_game
       FROM players p ${STATS} ${where}
      ORDER BY ${SORTS[key]}, p.username
      LIMIT ${PAGE} OFFSET $${args.length + 1}`,
    [...args, page(pg) * PAGE]
  );
  return {
    total, pageSize: PAGE, sort: key,
    players: r.rows.map((x) => ({ username: x.username, displayName: x.display_name, country: x.country || null, role: x.role, joinedAt: x.created_at, lastSeenAt: x.last_seen_at,
      suspended: Boolean(x.suspended_at), games: num(x.games), rated: num(x.rated), wins: num(x.wins), draws: num(x.draws), leftEarly: num(x.left_early), minutes: round1(x.minutes), lastGameAt: x.last_game })),
  };
}

/** One player's full profile. `actorId` gets an audit row ("player.view") in the same transaction as the read. */
async function playerProfile({ username, actorId }) {
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(u)) return { player: null };
  return db.withTransaction(async (c) => {
    const base = (await c.query(
      `SELECT p.id, p.username, p.display_name, p.country, p.role, p.created_at, p.last_seen_at, p.suspended_at,
              EXISTS (SELECT 1 FROM auth_identities i WHERE i.player_id = p.id AND i.email_verified_at IS NOT NULL) AS verified
         FROM players p WHERE p.username = $1 AND p.is_anonymous = FALSE LIMIT 1`, [u])).rows[0];
    if (!base) return { player: null };
    const id = base.id;
    const [total, perGame, recent, days, ...hours] = await Promise.all([
      c.query(`SELECT ${COUNTS}, MIN(m.started_at) AS first_game, MAX(m.finished_at) AS last_game
                 FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_id = $1 AND NOT mp.is_bot`, [id]),
      c.query(`SELECT m.game_id, ${COUNTS}
                 FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_id = $1 AND NOT mp.is_bot
                GROUP BY m.game_id ORDER BY games DESC, m.game_id`, [id]),
      c.query(`SELECT m.game_id, m.finished_at, m.seats, (${RATED} AND mp.is_winner) AS is_winner, (${RATED} AND mp.is_draw) AS is_draw, mp.left_early, (m.match_key IS NULL) AS unknown,
                      (EXTRACT(EPOCH FROM (m.finished_at - m.started_at)) / 60.0)::float AS minutes
                 FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_id = $1 AND NOT mp.is_bot
                ORDER BY m.finished_at DESC, m.id LIMIT 15`, [id]),
      c.query(`SELECT COUNT(DISTINCT (m.started_at AT TIME ZONE 'UTC')::date)::int AS days
                 FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_id = $1 AND NOT mp.is_bot`, [id]),
      // games started per hour of the day, once per supported zone, so the console can switch zones without asking (and auditing) again
      ...ZONES.map((z) => c.query(`SELECT EXTRACT(HOUR FROM m.started_at AT TIME ZONE $2::text)::int AS hour, COUNT(*)::int AS games
                 FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_id = $1 AND NOT mp.is_bot GROUP BY 1`, [id, z])),
    ]);
    if (actorId) {
      await c.query('INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [actorId, 'player.view', 'player', String(id).slice(0, 64), '{}']);
    }
    const t = total.rows[0] || {};
    const hourly = {};
    ZONES.forEach((z, i) => { hourly[z] = Array(24).fill(0); for (const r of hours[i].rows) hourly[z][r.hour] = r.games; });
    const games = num(t.games);
    const rated = num(t.rated);
    return {
      player: {
        username: base.username, displayName: base.display_name, country: base.country || null, role: base.role, verified: Boolean(base.verified),
        joinedAt: base.created_at, lastSeenAt: base.last_seen_at, suspended: Boolean(base.suspended_at),
      },
      totals: {
        games, rated, wins: num(t.wins), draws: num(t.draws), losses: Math.max(0, rated - num(t.wins) - num(t.draws)), leftEarly: num(t.left_early),
        minutes: round1(t.minutes), activeDays: num(days.rows[0] && days.rows[0].days), firstGameAt: t.first_game || null, lastGameAt: t.last_game || null,
      },
      perGame: perGame.rows.map((r) => ({ gameId: r.game_id, games: r.games, rated: r.rated, wins: r.wins, draws: r.draws, leftEarly: r.left_early, minutes: round1(r.minutes) })),
      hourly,
      recent: recent.rows.map((r) => ({ gameId: r.game_id, at: r.finished_at, seats: r.seats, won: r.is_winner, draw: r.is_draw, leftEarly: r.left_early, unknown: Boolean(r.unknown), minutes: round1(r.minutes) })),
    };
  });
}

module.exports = { listPlayers, playerProfile, PAGE, SORTS, clampSort, clampZone };
