# Responsive UI audit (phone and tablet layouts)

Status of the Phase 4 layout audit, as of `development` at `f582fbd` (PR #144 merged; sheets and topbar coverage added on this branch). This records what was run, what it found and what is still open. It is a snapshot: rerun the commands below after layout changes.

## Scope and what was run

| Check | Command | Scope | Result |
| --- | --- | --- | --- |
| Table game layout audit | `node tests/ui/game-audit.js` | 18 game setups (games at their seat counts), six sizes (320×568, 360×640, 390×844, 667×375, 768×1024, 1280×800), four moments each (start, early, late, over) | 0 errors, 160 warnings (see below) |
| Trump indicator regression (29) | `node tests/ui/twentynine-trump-ui.js` | 29 bidding, bidder's turn, choosing trump, and hidden / secret / revealed trump, six sizes | 35 passed, 0 failed, 1 exempt case |
| Phone fit (360×640) | `node tests/ui/mobile-fit.js` | 10 games, your-turn controls kept on screen | 15 passed, 0 failed |
| Wizard layout | `node tests/ui/wizard-layout.js` | Wizard, 29, poker and the others, six sizes | all viewports ok (one flaky page-load on tic-tac-toe in an earlier run; passed on re-run) |
| Sheets, dialogs, lobby, admin shell | `node tests/ui/sheets-layout.js` | 360×640 and 390×844. Guest login sheet and feedback dialog; signed-in what's new dialog, game log and leave confirmation (table in progress); lobby; admin page shell | 14 passed, 0 failed |

The Trump regression and the sheets test are now in `npm run test:ui`, so CI's browser job runs them. The game audit stays in `npm run test:audit` (manual).

The audit's `covers` check (a card covering a button or seat) found one ERROR in a single late-game 29 capture at 1280×800. It did not reproduce in two further runs, and the full audit run was clean, so it is treated as a capture taken mid-animation. It stays on the watch list.

## Warnings and their status

Warnings are not failures. The table below groups them and says whether each is a known limit or still to do.

| Warning | Where | Status |
| --- | --- | --- |
| Hand ends below the screen | Wizard 3 players and 29 at 320×568 (hand ends at 652 of 568) | Known limit. Short screens (SE-class) cannot fit the table, hand and buttons together without changing the game layout. Not changed in this pass. |
| Main button needs scrolling | Landscape 667×375 (roll, ask, ready) and 320×568 (Ready) | Expected on landscape and very short screens. Buttons are reachable by scrolling. |
| Bid button below the fold | Wizard 3 players at 320×568 and 667×375 | Same short-screen limit as above. |
| Open property cards under 30px | Property Rivals at 1280×800 (desktop, mouse) | Measured at 1280×800 with touch disabled in the emulation. That does not show the controls are unusable by touch: a tablet or touchscreen laptop can use this width. Touch coverage here is unverified. To fix later if this width needs touch use. |
| Clipped sr-only text | 29 at phone sizes | False positive. The screen-reader text is clipped on purpose. The audit now skips `.sr-only` (this pass). |
| Ludo tokens about 8–10px to tap (2-player late game at 320×568) | Ludo legal tokens, measured on the drawn token box | Measurement limit, not a touch failure. A legal token has an invisible 18px area (`.ludo-token.legal::after`, about 44px across). `tests/ui/ludo-token-tap-ui.js` taps 14px from a legal token's centre with a touchscreen tap at 320, 360 and 390px and checks that the same token receives the move. The audit still reports the drawn box as a warning. |

## Fixed in this pass

- The 29 Trump indicator on phones (see PR #144). The regression test checks, at each size, that one copy is on screen, inside the viewport (sideways and vertically), and states the trump (suit, secret, hidden or not chosen). Limits: the bidder's own turn on a short phone (at most 520px wide and 700px tall) is deliberately exempt, because no trump is set during bidding. The test checks bounding boxes and `innerText`, not what a screen reader actually announces, so assistive-technology behaviour is unverified.
- The audit no longer reports the intentional `sr-only` clip.
- The guest topbar (Feedback, Log in, Create account) was 19px wider than a 360px screen, so a logged-out visitor could scroll sideways on the smallest supported phone. Narrow-phone gaps and small-button padding now fit it (`public/style.css`, max-width 400px). Found by `sheets-layout.js`.

## Not verified here

- Real iOS Safari and Android Chrome devices were not available. All layouts were checked in Chromium emulation at the sizes above. A real iPhone 15 check remains a manual step.
- Admin: only the public admin page shell is checked (no sideways scroll at 360 and 390). The signed-in admin screens (staff views, moderation, audit trail) are not laid out-tested.
- Modals: covered by `sheets-layout.js`: login, feedback, what's new, game log, leave confirmation. Not covered, so unverified: join or spectate choice, edit profile, settings, delete account, game settings, player card, make host, remove player, remove friend, password reset and the report dialog.
- Lobby: `sheets-layout.js` checks no sideways scroll at 360 and the host's start control; `mobile-fit.js` checks compact height at 390. Lobby options and the invitation list are not covered at 360.
- Existing checks cover only part of the menus and lobby. `mobile-fit.js` checks a private Wizard lobby at 390×844 (the lobby check) and runs the in-game fit loops at 360×640; it also opens and closes the table's More menu. `touch-targets-ui.js` measures the home page controls and selected toolbar controls. Modals (confirmation dialogs, invitations, reports) are not exercised by any audit: their coverage is unverified.

## Next steps

1. Triage the short-screen hand limit with the owner: accept it for SE-class phones, or plan a layout change. A game-layout change needs approval because it touches play areas.
2. Extend the sheet and modal coverage to the unverified dialogs listed above, and the signed-in admin screens (needs a staff test account in the harness).
3. Decide whether the desktop Property Rivals card size warning is in scope.
4. Run this audit on a real iPhone before the friends beta.
