# Changelog

## Unreleased (on `development`, not yet on `main`)
- Leaving a game with others still playing counts as a loss, unless a second person also leaves (then the game is abandoned). Bots-only leaves do not count.
- Take your seat back within `REJOIN_GRACE_SECONDS` (default 120) of your first departure: the penalty goes. After that the bot keeps the seat.
- Active play time: XP and `seconds_played` count only the time a person was seated and connected. A dropped connection pauses it.
- Progress levels, per-game skill points, version history, shutdown saves leavers' losses (migration 025 and 026).

Details: `docs/LEAVING_AND_REJOINING.md`, `docs/PROGRESS_LEVELS.md`.
