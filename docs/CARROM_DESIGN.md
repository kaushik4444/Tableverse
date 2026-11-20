# Carrom: design note (not built yet)

Status: built, in review on `feat/carrom`. Physics, rules, board and tests are in `games/carrom/` and `public/games/carrom.js`.

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

## Scope (first version, as built)

- 2 players (one colour each). Four players in two teams is not built.
- Pocketing your own coin gives another shot. Coins of the other colour go back to the centre.
- The queen is covered when you pocket it in the same shot as one of your coins, or once you hold all nine. A covered
  queen is yours; an uncovered one goes back to the centre.
- Foul: pocketing the striker. The coins of that shot go back, and one coin you hold goes back too.
- Win: pocket all nine of your coins with the queen held. Resignation and a 300-shot move limit (a draw) also end a game.
- The bot tries 16 random flicks on a copy of the table and plays the best.

## Aiming (as built)

Sliders for striker position, angle (within 75 degrees) and power. A drag-to-aim on the board is not built; it is the
obvious next improvement if the sliders feel slow on phones.

## Open questions

- The physics module is `games/carrom/physics.js`. Ball Pong, Pool and Bowling should reuse it or copy its approach; the
  module has not been generalised yet.
- Friction, restitution and mass values are tuned by hand; the tests check distances, not match play.
- Four players in two teams is not built.
