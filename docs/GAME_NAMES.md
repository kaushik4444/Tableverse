# Game names: trademark and copyright review

**Not legal advice.** This is a working risk review by the engineering team. Owners, registration status and classes were
researched from public sources and are **not verified** on USPTO / EUIPO / DPMA. Before a public (commercial) launch, check
each name in the target markets (a trademark search or a short lawyer review is cheap compared with a forced rename).

## The rule we follow

- **Game rules and mechanics are not protected** by copyright or trademark. Anyone may implement "a game where you ..." .
- **Names, logos, artwork, card designs, rule-book wording, and distinctive component sets** are protected.
- So: our own implementation, our own wording, our own art, and a **name that is not another company's brand**.
  Where a well-known brand is the natural name, we use a neutral name instead.

## Audit

| Game | Name in app | Risk | Notes / action |
|---|---|---|---|
| Wizard | Wizard | **Medium** | "Wizard" is the trade name of a commercial trick-taking card game (U.S. Games Systems). The word is generic in fantasy, but as a *game title* it is the brand. Not verified. **Recommend a neutral rename before commercial launch** (e.g. "Trick Prophet"); rename only with owner approval. |
| Twenty-nine | Twenty-nine / 29 | Low | Traditional card game, no known owner of the name. |
| Poker | Poker | Low | Generic game name. Avoid "World Series of Poker", "Texas Hold'em" branding of third parties (we only use the generic name). |
| The Mind | The Mind | **Medium** | Title of a published game (Pandasaurus / NSV). Our implementation is original, but the title is the brand. Not verified. **Recommend a neutral rename** (e.g. "Quiet Count"). |
| Ludo | Ludo | Low | Generic/traditional name. ("Parcheesi" and "Mensch ärgere dich nicht" are brands/trade names: do not use them.) |
| Go Fish | Go Fish | Low | Traditional children's game. Do not use publisher card artwork. |
| Snakes and Ladders | Snakes and Ladders | Low | Traditional. **Do not use "Chutes and Ladders"** (Hasbro/Milton Bradley trademark). Own board layout is used. |
| Property Rivals | Property Rivals | Low | Neutral name. Avoid "Monopoly", "Free Parking" etc. and the original board, token and card wording. |
| Tic-Tac-Toe | Tic-Tac-Toe | Low | Generic. |
| Four in a Row | Four in a Row | Low-medium | "Connect Four" is a Hasbro trademark; we use the generic descriptive name only. Keep it that way. |
| Penalty Rows | Penalty Rows | Low | New. Neutral name for a "6 nimmt!" / "Take 5" style game. Do **not** use "6 nimmt!", "Take 5", "Category 5" or the cow-head artwork. Own penalty table, own wording. |
| Stage Rummy | Stage Rummy | Low | Planned. Neutral name for a "Phase 10" style game. "Phase 10" is a registered trademark (U.S. Reg. No. 1849974, Mattel); do **not** use it, its card set or its phase-card wording. Own cards, own scoring wording. |

## Never use

Phase 10, 6 nimmt!, Take 5, Category 5, Connect Four, Chutes and Ladders, Monopoly, Uno, Parcheesi, Scrabble, Catan, Cluedo,
Beer Pong (as a *brand*-style product name), and any publisher's art or rule-book text.

## Other things to keep clean

- **Artwork**: all card and board art is drawn in code (CSS/SVG) or original. No scans, no copied icon sets.
- **Rule text** in `rules` arrays is written in our own words.
- **Fonts and sounds**: only those already licensed in the repository.

## Suggested follow-up (owner decision)

1. Decide whether to rename **Wizard** and **The Mind** before any commercial launch (code change is small: `name`, `tagline`, docs, tests).
2. Run a proper trademark search in the target markets for every name in the table.
3. Re-check this table whenever a game is added (see `docs/PLANNED_GAMES.md`).
