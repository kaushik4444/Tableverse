# Changelog

User-facing changes are listed first. Operational and internal implementation details belong in the project documentation, not in these release notes.

## 0.14.0 — Voice chat

- Talk with people at your table using in-browser voice chat, in the lobby and during games.
- Mute your microphone or listen without speaking.
- See who has joined voice and who is currently speaking.
- Voice supports up to eight people per table.
- No app installation is required; use Tableverse over HTTPS and allow microphone access.
- Audio is peer-to-peer (WebRTC). Some network combinations may require a relay, so connection quality can vary.
- Voice starts off and is enabled only when a player chooses to join. Peer-to-peer participants may learn connection information such as IP addresses.
