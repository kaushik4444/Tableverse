# Game names: trademark and copyright review

**Not legal advice.** This is a working risk review by the engineering team. Owners, registration status and classes were
researched from public sources and are **not verified** on USPTO / EUIPO / DPMA. Before a public (commercial) launch, check
each name in the target markets (a trademark search or a short lawyer review is cheap compared with a forced rename).

## The rule we follow

- **Game rules and mechanics are not protected** by copyright or trademark (those two only: a specific mechanic can still be covered by a **patent**, so check for patents on anything unusual before building it). Implementing "a game where you ..." is generally allowed under those two.
- **Names, logos, artwork, card designs, rule-book wording, and distinctive component sets** are protected.
- So: our own implementation, our own wording, our own art, and a **name that is neither another company's brand nor confusingly similar to it** (spelling variants, sound-alikes and added words can still infringe: check similar marks, not only exact names).
  Where a well-known brand is the natural name, we use a neutral name instead.

## Audit

| Game | Name in app | Risk | Notes / action |
|---|---|---|---|
| Wizard | Wizard | **Medium** | "Wizard" is the trade name of a commercial trick-taking card game (U.S. Games Systems). The word is generic in fantasy, but as a *game title* it is the brand. Not verified. **Recommend a neutral rename before commercial launch** (e.g. "Trick Prophet"); rename only with owner approval. |
| Twenty-nine | Twenty-nine / 29 | Low | Traditional card game, no known owner of the name. |
| Poker | Poker | Low | Generic game name. Avoid "World Series of Poker", "Texas Hold'em" branding of third parties (we only use the generic name). |
| Mind | Mind | **Medium** | Owner decision (2026-11-19): shown as "Mind", internal id `themind` unchanged. "The Mind" is the title of a published game (Pandasaurus / NSV) and "Mind" is close to it. Our implementation is original, with our own cards and wording. Not verified. Keep it under review before a commercial launch. |
| Ludo | Ludo | Low | Generic/traditional name. ("Parcheesi" and "Mensch ärgere dich nicht" are brands/trade names: do not use them.) |
| Go Fish | Go Fish | Low | Traditional children's game. Do not use publisher card artwork. |
| Snakes and Ladders | Snakes and Ladders | Low | Traditional. **Do not use "Chutes and Ladders"** (Hasbro/Milton Bradley trademark). Own board layout is used. |
| Property Rivals | Property Rivals | Low | Neutral name. Avoid "Monopoly", "Free Parking" etc. and the original board, token and card wording. |
| Tic-Tac-Toe | Tic-Tac-Toe | Low | Generic. |
| Four in a Row | Four in a Row | Low-medium | "Connect Four" is a Hasbro trademark; we use the generic descriptive name only. Keep it that way. |
| Take 5 | Take 5 | **Medium-high** | Owner decision (2026-11-19): shown as "Take 5", internal id `penaltyrows` unchanged. "Take 5" is a known English title of AMIGO's "6 nimmt!", and the owner is awaiting AMIGO's response. Do **not** use "6 nimmt!" or "Category 5", the cow-head artwork or the rule-book text. Own penalty table, own wording and artwork. Not legal advice; not verified. |
| Stage 10 | Stage 10 | **Medium** | Owner decision (2026-11-19): shown as "Stage 10", internal id `stagerummy` unchanged. "Phase 10" is a registered trademark (U.S. Reg. No. 1849974, Mattel) and "Stage 10" is a close variant: a sound-alike can still be confusing. Do **not** use "Phase 10", its card set, logos or phase-card wording. Own cards, own scoring wording. Not verified. |

## Non-affiliation

The in-app rules of Take 5, Stage 10 and Mind say that they are Tableverse's own games, not affiliated with, endorsed by or licensed by the publisher of any similar game. Keep that line, and do not use any publisher's logo, artwork, packaging or rule-book text. No publisher has been contacted and no legal setting was changed by the rename.

## Never use

Phase 10, 6 nimmt!, Category 5, The Mind (as a title), Connect Four, Chutes and Ladders, Monopoly, Uno, Parcheesi, Scrabble, Catan, Cluedo,
Beer Pong (as a *brand*-style product name), and any publisher's art or rule-book text.

## Other things to keep clean

- **Artwork**: all card and board art is drawn in code (CSS/SVG) or original. No scans, no copied icon sets.
- **Rule text** in `rules` arrays is written in our own words.
- **Fonts and sounds**: only those already licensed in the repository.

## Suggested follow-up (owner decision)

1. Decide whether to rename **Wizard** and **The Mind** before any commercial launch (code change is small: `name`, `tagline`, docs, tests).
2. Run a proper trademark search in the target markets for every name in the table.
3. Re-check this table whenever a game is added (see `docs/PLANNED_GAMES.md`).
