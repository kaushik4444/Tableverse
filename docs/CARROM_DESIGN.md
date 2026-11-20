# Carrom: design note (not built yet)

Status: planned. Chess is in review on PR #266. Nothing for carrom is in the code.

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

## Scope (first version)

- 2 players (one colour each) or 4 players in two teams. Start with 2.
- Pocket your own colour; the queen must be covered by your next pocketed piece or it returns to the centre.
- Foul: pocketing the striker, or not hitting a piece of your own colour, costs a piece back to the table.
- First to pocket all nine of its own colour (plus the queen) wins.

## Open questions

- Friction, restitution and mass values: tune them with unit tests that check a flick travels a sensible distance.
- Mobile aiming: the touch target should not hide the board. Use a drag-to-aim line with a power bar.
- Whether the rules text should follow a named rule set. Keep the wording generic.

## Next steps

1. `games/carrom/physics.js`: pure simulation, with tests for collisions, cushions, pockets and settling.
2. `games/carrom/engine.js` and `index.js`: turns, fouls, queen rule, results, bot.
3. `public/games/carrom.js` and `.css`: board, aim, keyframe playback, phone layout.
4. Tests: physics, engine and a browser test. Add to `npm test` and `test:ui`.
