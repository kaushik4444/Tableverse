# Changelog

User-facing changes are listed first. Operational and internal implementation details belong in the project documentation, not in these release notes.

## Unreleased

- 29 and Wizard: the rule options (29) and Shuffle seats (Wizard) start switched on in a new table. The host can still change them in the lobby.
- 29: the whole answering side may double, redouble or accept, and one answer decides for both players.
- Blocking: block and unblock send one request at a time, and an error names the action that failed.
- The ⋯ menu has the same labels in the same order in every game.
- Ludo with six players: the outer yard of the seat to play blinks.

## Released 2026-11-14 (release PR #165)

- New game tables are public by default, so they appear in the open tables. To make a table private, use **Make private** in its lobby (it is not offered once a game has started). Members and spectators already at the table keep access after it is made private.
- 29 on phones: the trump suit, or that it is still hidden or not yet chosen, stays on screen during play. While bidding no trump is set yet.
- Keep me signed in on this device: an optional tick on the sign-in form keeps this browser signed in for 30 days after its last visit. The browser's trust ends when you sign out, sign out everywhere, reset your password, or an owner suspends or signs out your account.
- Owners can send e-mail from the admin console to everyone, to verified or unverified accounts, or to accounts not seen for 30 days. Promotional mail carries an unsubscribe link and goes only to verified accounts that have not opted out. Account mail (verification, password reset) is unchanged.
- Property Rivals: tap a city in the player list to see its owner, buildings, rent now, the full rent table, and the mortgage, unmortgage and house costs.
- Property Rivals: each player shows cash and net worth separately. The crown marks the player with the highest net worth, not the most cash.
- Every game shows its current settings at the top right. Tap them for the full list with each choice explained.
- Blocking hides the blocked player's table chat and voice and stops invitations between you. A block no longer removes anyone from a table, so blocked players can share one.
- Block and report a player from their table card or profile page. A report has a reason and is stored once per reporter and player.
- 29 rule options are explained in Game settings; Wizard and 29 have a host-controlled Shuffle seats option.
- How to play, the game log and game settings are in the ⋯ menu.

## 0.14.0 — Voice chat

- Talk with people at your table using in-browser voice chat, in the lobby and during games.
- Mute your microphone or listen without speaking.
- See who has joined voice and who is currently speaking.
- Voice supports up to eight people per table.
- No app installation is required; use Tableverse over HTTPS and allow microphone access.
- Audio is peer-to-peer (WebRTC). Some network combinations may require a relay, so connection quality can vary.
- Voice starts off and is enabled only when a player chooses to join. Peer-to-peer participants may learn connection information such as IP addresses.
