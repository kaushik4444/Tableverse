# Changelog

## Unreleased (on `development`, not yet on `main`)
- Privacy notice rewritten from the owner's decisions (not published): legal basis per purpose, provider locations and transfers, retention checked against the code, staff and production access, the manual data-request process, and a corrected usage-statistics statement. Open items stay as markers in the text. Owner decisions, code check and open items: `docs/PRIVACY_NOTICE_OWNER_DECISIONS.md`. Consistency tests: `tests/privacy-notice.test.js`.
- Public contact address: the Impressum, privacy notice and terms show `PUBLIC_CONTACT_EMAIL` when it is set (Render), otherwise `IMPRESSUM_EMAIL`. No address is written into the code or the legal texts. Sign-in, Google and outgoing mail are unchanged.
- Fixes from the release review: Penalty Rows uses its own style scope and keeps its phase when a deleted player's name is scrubbed; one awaited seat keeps its turn deadline; the account and reports wording in the privacy and retention docs now matches the code.
- Profile: the minutes to the next level and a one-time level-up notice (the notice is remembered on this device, for each account).
- Home footer: a link to @playtableverse on Instagram, opened in a new tab.
- What's new: a new top entry for the level notice and the Instagram link (`public/whats-new-data.js`).
- Sign in with Google (optional, off until `GOOGLE_CLIENT_ID` is set). Google-only accounts delete with a fresh Google sign-in. "Keep me signed in" works on Google sign-in and sign-up.
- Owner can permanently delete a stale ordinary account (typed username confirmation, audited without e-mail); Users tab filter for accounts not seen for 30+ days.
- Leaving a game with others still playing counts as a loss, unless a second person also leaves (then the game is abandoned). Bots-only leaves do not count.
- The third leave of one person in a game is a final penalty: rejoining inside the window still works, but it no longer removes the penalty.
- Take your seat back within `REJOIN_GRACE_SECONDS` (default 120) of your first departure: the penalty goes. After that the bot keeps the seat.
- Active play time: XP and `seconds_played` count only the time a person was seated and connected. A dropped connection pauses it.
- Game over: no progress cards. One table shows each person's XP in this game and their lifetime XP in the same game (`gameTotals`, read from stored matches after this game is written).
- Level-up dialog: when you reach a new level, the next menu visit shows "Congratulations on reaching level X" with the XP to the next level, and an OK button. Shown once per level, per device.
- Admin console: every table can be sorted by its columns. The player directory and the users list sort on the server; the other tables sort in the page. The player directory shows each player's level (for the players on the page).
- Player card at the table shows the player's level and their lifetime XP in the game being played. The public profile API returns the level and each game's XP and games played (no minutes or leave counts). Privacy notice updated to match.
- Privacy notice: describes the opt-in weekly board and what staff see in the admin console.
- Leave rule: a third leave keeps its final penalty even when it is the leave that abandons the game (a test that asserted the opposite was corrected).
- Progress levels, per-game skill points, version history, shutdown saves leavers' losses (migration 025 and 026).

Details: `docs/LEAVING_AND_REJOINING.md`, `docs/PROGRESS_LEVELS.md`.
