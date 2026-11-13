# Responsive UI audit (phone and tablet layouts)

Status of the Phase 4 layout audit, as of `development` at `fe1cab2` (PR #144 merged). This records what was run, what it found and what is still open. It is a snapshot: rerun the commands below after layout changes.

## Scope and what was run

| Check | Command | Scope | Result |
| --- | --- | --- | --- |
| Table game layout audit | `node tests/ui/game-audit.js` | 21 game setups (games at their seat counts; Ludo at 2, 4 and 6 players was added in this pass), six sizes (320×568, 360×640, 390×844, 667×375, 768×1024, 1280×800), four moments each (start, early, late, over) | 0 errors, 147 warnings (see below) |
| Trump indicator regression (29) | `node tests/ui/twentynine-trump-ui.js` | 29 bidding, bidder's turn, choosing trump, and hidden / secret / revealed trump, six sizes | 35 passed, 0 failed, 1 exempt case |
| Phone fit (360×640) | `node tests/ui/mobile-fit.js` | 10 games, your-turn controls kept on screen | 15 passed, 0 failed |
| Wizard layout | `node tests/ui/wizard-layout.js` | Wizard, 29, poker and the others, six sizes | all viewports ok (one flaky page-load on tic-tac-toe in an earlier run; passed on re-run) |

The audit's `covers` check (a card covering a button or seat) found one ERROR in a single late-game 29 capture at 1280×800. It did not reproduce in two further runs, and the full audit run was clean, so it is treated as a capture taken mid-animation. It stays on the watch list.

## Warnings and their status

Warnings are not failures. The table below groups them and says whether each is a known limit or still to do.

| Warning | Where | Status |
| --- | --- | --- |
| Hand ends below the screen | Wizard 3 players and 29 at 320×568 (hand ends at 652 of 568) | Known limit. Short screens (SE-class) cannot fit the table, hand and buttons together without changing the game layout. Not changed in this pass. |
| Main button needs scrolling | Landscape 667×375 (roll, ask, ready), 320×568 (Ready) and Ludo's Roll dice at 320×568 | Expected on landscape and very short screens. Buttons are reachable by scrolling. |
| Bid button below the fold | Wizard 3 players at 320×568 and 667×375 | Same short-screen limit as above. |
| Open property cards under 30px | Property Rivals at 1280×800 (desktop, mouse) | Measured at 1280×800 with touch disabled in the emulation. That does not show the controls are unusable by touch: a tablet or touchscreen laptop can use this width. Touch coverage here is unverified. To fix later if this width needs touch use. |
| Ludo token tap targets | Ludo at 320×568 (late game): the coin is about 10px | Not a problem. A legal token is tapped through an invisible hit area (`.ludo-token.legal::after`, 18px outside each side), about 46px across. The audit now measures that area for legal tokens only. The coin is not changed. |
| Clipped sr-only text | 29 at phone sizes | False positive. The screen-reader text is clipped on purpose. The audit now skips `.sr-only` (this pass). |

## Fixed in this pass

- The 29 Trump indicator on phones (see PR #144). The regression test checks, at each size, that one copy is on screen, inside the viewport (sideways and vertically), and states the trump (suit, secret, hidden or not chosen). Limits: the bidder's own turn on a short phone (at most 520px wide and 700px tall) is deliberately exempt, because no trump is set during bidding. The test checks bounding boxes and `innerText`, not what a screen reader actually announces, so assistive-technology behaviour is unverified.
- The audit no longer reports the intentional `sr-only` clip.

## Not verified here

- Real iOS Safari and Android Chrome devices were not available. All layouts were checked in Chromium emulation at the sizes above. A real iPhone 15 check remains a manual step.
- Admin, moderation and account screens were not part of this audit run. They need their own pass.
- Existing checks cover only part of the menus and lobby. `mobile-fit.js` checks a private Wizard lobby at 390×844 (the lobby check) and runs the in-game fit loops at 360×640; it also opens and closes the table's More menu. `touch-targets-ui.js` measures the home page controls and selected toolbar controls. Modals (confirmation dialogs, invitations, reports) are not exercised by any audit: their coverage is unverified.

## Next steps

1. Triage the short-screen hand limit with the owner: accept it for SE-class phones, or plan a layout change. A game-layout change needs approval because it touches play areas.
2. Add the admin, lobby and modal screens to the audit.
3. Decide whether the desktop Property Rivals card size warning is in scope.
4. Run this audit on a real iPhone before the friends beta.
