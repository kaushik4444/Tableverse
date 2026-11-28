# Carrom: design note (built)

Status: built and on `development` (merged in #302 and #331). Owner decision (2026-11-28): open to players for the beta launch; the admin console's Games tab must show it as Enabled. Two to four players in teams, drag-to-aim with a striker slider. Physics, rules, board and tests are in `games/carrom/` and `public/games/carrom.js`.

## Decisions

- **Authoritative server simulation.** The server runs the physics and sends the result to the clients as keyframes.
  Clients only animate them. This keeps the outcome identical for every player and stops a client from cheating.
  The physics module must be pure (no I/O, no clock) and take the rng from the table, like the other games.
- **Fixed time step.** Step at 1/240 s until every disc slows below a small threshold or 20 simulated seconds pass.
  Sample keyframes at about 20 per second and round positions to 3 decimals, so the payload stays small.
- **Turn input.** The player aims by an angle and a power, and flicks the striker along the baseline. The striker's
  position along the baseline is also chosen by the player.
- **Shared physics note.** `docs/PLANNED_GAMES.md` says the physics decision should be shared with the other physics
  games (Ball Pong, Pool, Bowling). Decide the module shape once, for those games too, before building carrom.

## Scope (as built)

- Two to four players. With four, partners sit opposite each other and share a colour: seats 0 and 2 play White,
  seats 1 and 3 play Black. Three players are also allowed (seats 0 and 2 White, seat 1 Black).
- Each seat's shot is given in its own frame. The server simulates in the bottom side's frame and rotates each shot into
  place, so every seat plays from its own baseline.
- Scoring is per team (colour). Pocketing one of your own coins gives another shot. Coins of the other colour go back to
  the centre.
- The queen is covered when your team pockets it in the same shot as one of its coins, or once it holds all nine. A
  covered queen is held by the team; an uncovered one goes back to the centre.
- Foul: pocketing the striker. The coins of that shot go back, and one coin the team holds goes back too.
- Win: the team pockets all nine of its coins with the queen held. Resignation and a 300-shot move limit (a draw) also end
  a game.
- The bot tries 16 random flicks on a copy of the table and plays the best.

## Aiming (as built)

Drag the striker along your baseline to place it. Then drag back from the board and let go to flick. The further you
drag, the harder the flick (within 75 degrees for the angle). Speed grows with the square root of power, so the distance the
striker slides grows in a straight line with power. There are no sliders: the keyboard does the same job (← → place, Shift+←
→ turn, ↑ ↓ power, Enter fires).

## Open questions

- The physics module is `games/carrom/physics.js`. Ball Pong, Pool and Bowling should reuse it or copy its approach; the
  module has not been generalised yet.
- Friction, restitution and mass values are tuned by hand; the tests check distances, not match play.
- The rules are simplified on purpose: no break rules, no penalty for the queen, and no timer per shot.
