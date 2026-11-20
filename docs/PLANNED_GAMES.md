# Planned games (not built yet)

Ideas only. Nothing here is committed to a release. Each needs a design note and a name check
(`docs/GAME_NAMES.md`) before work starts. Order is not a promise.

| Game | Players | Name / trademark notes | Design questions |
|---|---|---|---|
| Carrom (in review on `feat/carrom`, 2–4 players; design in `docs/CARROM_DESIGN.md`) | 2–4 | Traditional game, generic name. Avoid commercial brand names for sets. | Break rules, a per-shot timer and drag-to-aim on very small screens are not built. |
| Chess (in review on `feat/chess-carrom`, see `games/chess/`) | 2 | Generic. Avoid "FIDE", site/brand names. Own piece art. | Clocks are not built. Rating and resume-later are not built. |
| Ball Pong | 2–4 | "Beer Pong" is used as a brand-style name and is alcohol-themed: use a neutral name such as "Ball Pong" and a non-alcohol theme (cups, balls). | Throw physics, arc, authoritative server vs. seeded simulation, lag fairness. |
| Pool | 2 | Generic. Do not use league or brand logos (e.g. "8-Ball Pool" as an app brand). | Physics fidelity, shot aiming on mobile, rules variant (8-ball first). |
| Bowling | 2–6 | Generic. | Swipe-to-roll input, simple physics or probability model, score sheet. |

Physics-based games (Carrom, Ball Pong, Pool, Bowling) share needs: an authoritative, deterministic simulation, touch aiming,
and tolerance for latency on the single-instance server. A shared physics decision should be taken once, not per game.

In progress / built recently: Take 5 (PR #223). Next in the queue: Stage 10.
