# Changelog

User-facing changes are listed first. Operational and internal implementation details belong in the project documentation, not in these release notes.

## Unreleased

- Property Rivals: tap a city in the player list to see its owner, buildings, rent now, the full rent table, and the mortgage, unmortgage and house costs.
- Property Rivals: each player shows cash and net worth separately. The crown marks the player with the highest net worth, not the most cash.
- Every game shows its current settings at the top right. Tap them for the full list with each choice explained.
- Blocking hides the blocked player's table chat and voice and stops invitations between you. A block no longer removes anyone from a table, so blocked players can share one.

## 0.14.0 — Voice chat

- Talk with people at your table using in-browser voice chat, in the lobby and during games.
- Mute your microphone or listen without speaking.
- See who has joined voice and who is currently speaking.
- Voice supports up to eight people per table.
- No app installation is required; use Tableverse over HTTPS and allow microphone access.
- Audio is peer-to-peer (WebRTC). Some network combinations may require a relay, so connection quality can vary.
- Voice starts off and is enabled only when a player chooses to join. Peer-to-peer participants may learn connection information such as IP addresses.
