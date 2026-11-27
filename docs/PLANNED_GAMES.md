# Planned games (ideas, not committed)

Built since this list was started: Sudoku, Chess, Carrom, Color Clash, Hidden Miners, Bingo, Dots and Boxes, Falling Blocks, Sea Battle, Memory Match and Resource Isles for four players (in draft, see `games/resourceisles/`). The Ball Pong idea is now Cup Pong below. Bullhead Run was only a working title for Take 5, so it is not planned separately.

Ideas only. Nothing here is committed to a release. Each needs a design note and a name check
(`docs/GAME_NAMES.md`) before work starts. Order is not a promise.

| Game | Players | Name / trademark notes | Design questions |
|---|---|---|---|
| Place Animal Thing | TBD | Generic. Own animal art; no commercial brand or character names. | Rules not yet defined. Placement rules, turn order and win condition to be decided by the owner. |
| Cup Pong (formerly the Ball Pong idea) | 2–4 | Use "Cup Pong" and a non-alcohol theme (cups, balls); never "Beer Pong". "Pong" alone is a trademarked arcade title, so keep the full name and own art. | Same physics needs as Ball Pong. |
| Pool | 2 | Generic. Do not use league or brand logos (e.g. "8-Ball Pool" as an app brand). | Physics fidelity, shot aiming on mobile, rules variant (8-ball first). |
| Bowling | 2–6 | Generic. | Swipe-to-roll input, simple physics or probability model, score sheet. |

Physics-based games (Carrom, Ball Pong, Pool, Bowling) share needs: an authoritative, deterministic simulation, touch aiming,
and tolerance for latency on the single-instance server. A shared physics decision should be taken once, not per game.

Built recently: Take 5, Stage 10, Chess, Hidden Miners and Color Clash are open to players, and Carrom is in admin testing. No game in this list is in progress.
