# Leaving, rejoining and play time

Status: implemented on `development`, not yet released to `main`. Code: `lib/leavePolicy.js` (leave, rejoin window and
penalty), `lib/playTime.js` (active play time), `db/matchRecord.js` (what is stored), `server.js` (the wiring). Tests:
`tests/leave-policy.test.js`, `tests/rejoin-window.test.js`, `tests/match-forfeit.test.js`. Shown to players in the leave prompt.

## Leaving a running game
- With other people still playing, leaving asks first. A bot takes the seat and the others keep playing.
- If the game finishes without a second person leaving, the leaver's result is a **loss** (and the game penalty, see
  `docs/PROGRESS_LEVELS.md`). Against bots only, leaving is not penalised.
- A second person leaving while a penalty is pending **abandons** the game: nobody is penalised, the people who stayed get
  no result, and nobody can take a seat back in it.
- **Counting leaves:** each time a person leaves the same game counts, and taking the seat back does not reset the count.
  - Their **first and second** leave are pending penalties. Taking the seat back inside the window removes them.
  - Their **third** leave in the game is **final**: the penalty is applied directly and stays even after they come back, and
    it is still written if the game is abandoned later by someone else. Coming back inside the window is still allowed.
  - Further leaves by the same person are final too and never abandon the game by themselves.

## The rejoin window
- A person who leaves on purpose can take their own seat back during a window of **2 minutes** by default. Set it with
  `REJOIN_GRACE_SECONDS` (0 to 600; a missing or invalid value uses 120).
- The window starts at the **first** departure of that person in that game. Leaving and rejoining again does not restart
  it, so repeated attempts cannot extend it. The deadline itself is still in time; one millisecond after is too late.
- Taking the seat back within the window removes the pending penalty of a first or second leave, and play resumes. A
  final (third) penalty is not removed.
- After the window, the bot keeps the seat for the rest of the game and the penalty stands. The person may still watch as
  a spectator. Once a window has passed it cannot be reopened.
- A game can only be rejoined while it is running and not abandoned.

## Network drops are not departures
- A lost connection does not make a bot take the seat, does not start the window and does not penalise anyone. The seat
  stays with the player (the game waits for a move or auto-plays it, as before).
- While the connection is lost, the person's active play time is paused. Reconnecting resumes it.

## Active play time (what XP and the stored `seconds_played` use)
- A seated person's time runs from the start of the game (or from taking the seat back) until they leave, lose their
  connection (paused) or the game ends.
- Summed over every stretch they played, capped at six hours per game.
- Spectators never earn time. Bots never earn time. A person who sat down late earns only from when they sat.
- A leaver keeps the time up to the moment they left. Their time is stored with the record, so past games stay as they
  were (see `docs/PROGRESS_LEVELS.md`).

## Restarts, abandoned games and deleted accounts
- Running tables live in memory. On a restart, a leaver's loss is saved from the table as it was (only the people who
  left are written). Unfinished games are not recorded as finished, and no rejoin window survives the restart.
- While the server is stopping, games do not move on and seats cannot change, so the saved state is the final state.
- An abandoned game gives nobody a seat back.
- A deleted account is removed from its table as before. Its stored results keep the "Deleted player" name.

## Operations
- `REJOIN_GRACE_SECONDS` is read when the server starts. Changing it needs a restart, and it affects only games started
  after the change; the window of a game in progress was fixed when the person left.
- No database migration is needed for the rejoin window: it uses the columns added by migrations 024 to 026.
