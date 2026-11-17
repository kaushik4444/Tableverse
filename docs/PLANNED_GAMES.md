# Planned games (not built yet)

Ideas only. Nothing here is committed to a release. Each needs a design note and a name check
(`docs/GAME_NAMES.md`) before work starts. Order is not a promise.

| Game | Players | Name / trademark notes | Design questions |
|---|---|---|---|
| Carrom | 2–4 | Traditional game, generic name. Avoid commercial brand names for sets. | Physics (striker flick, collisions) on the server or deterministic on the client? Mobile touch aiming. |
| Chess | 2 | Generic. Avoid "FIDE", site/brand names. Own piece art. | Clocks, draw rules, resign/rejoin, optional rating. Existing engines can be used only if the licence fits (check). |
| Ball Pong | 2–4 | "Beer Pong" is used as a brand-style name and is alcohol-themed: use a neutral name such as "Ball Pong" and a non-alcohol theme (cups, balls). | Throw physics, arc, authoritative server vs. seeded simulation, lag fairness. |
| Pool | 2 | Generic. Do not use league or brand logos (e.g. "8-Ball Pool" as an app brand). | Physics fidelity, shot aiming on mobile, rules variant (8-ball first). |
| Bowling | 2–6 | Generic. | Swipe-to-roll input, simple physics or probability model, score sheet. |

Physics-based games (Carrom, Ball Pong, Pool, Bowling) share needs: an authoritative, deterministic simulation, touch aiming,
and tolerance for latency on the single-instance server. A shared physics decision should be taken once, not per game.

In progress / built recently: Penalty Rows (PR #223). Next in the queue: Stage Rummy.
