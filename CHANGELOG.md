# Changelog

## Unreleased (on `development`, not yet on `main`)
- Profile: the minutes to the next level and a one-time level-up notice (the notice is remembered on this device, for each account).
- Home footer: a link to @playtableverse on Instagram, opened in a new tab.
- Sign in with Google: server routes and config are in place. Off unless `GOOGLE_CLIENT_ID` is set; not configured in production.
- What's new: a new top entry for the level notice and the Instagram link (`public/whats-new-data.js`).
- Leaving a game with others still playing counts as a loss, unless a second person also leaves (then the game is abandoned). Bots-only leaves do not count.
- Take your seat back within `REJOIN_GRACE_SECONDS` (default 120) of your first departure: the penalty goes. After that the bot keeps the seat.
- Active play time: XP and `seconds_played` count only the time a person was seated and connected. A dropped connection pauses it.
- Progress levels, per-game skill points, version history, shutdown saves leavers' losses (migration 025 and 026).

Details: `docs/LEAVING_AND_REJOINING.md`, `docs/PROGRESS_LEVELS.md`.
