# Chat moderation and abuse protection

This is the minimum needed to report abusive table chat and to hide an account's chat from one player. It is enforced on
the server. It does not replace human review, and it does not take automatic action against anyone.

## What a player can do

| Action | Where | Effect |
| --- | --- | --- |
| **Block** a player's chat | "Block chat" button on another player's chat message | Their table chat is never sent to you, on any table, until you unblock. Chat history already on your screen is re-sent without them. |
| **Report** a message | Report button, then a reason | Records the report in the database. There is no review queue yet. Nothing is hidden or sanctioned automatically. |
| **Unblock** | WebSocket action `unblock` (no button yet) | Restores their chat. |
| **Mute** (local) | Existing mute in the chat list | Hides that player's messages in this browser only. Not enforced on the server. |

## Enforcement

- **Blocks are applied on the server.** When a socket joins, the server loads the account's blocked ids and keeps them on
  the player. Live chat (`pushChat`) and the history sent on join or reconnect both pass through
  `lib/moderation.js` `shouldDeliver` / `visibleChat`, so a blocked message is never sent to the blocker's socket. A pending block is filtered immediately while its database write is queued or in flight.
- **Chat blocks are one way.** When A blocks B, B's messages are not delivered to A. B can still receive A's messages, and
  B is not told about the block.
- **Voice and reactions are blocked in both directions.** A block in either direction keeps the pair out of each other's
  table voice: each browser is offered only the people it may hear, so an existing connection to the other person closes.
  A signal between them is refused with the same answer as "not in voice", and reactions are not delivered either way.
  Friend requests and private-table invitations are also refused across a block (`db/friends.js`).
- **System lines always show** (the game and table events), even to a blocker.
- **Report text comes from the server.** Each table message has a random id (`mid`). The report carries only the id, a
  reason and optional details. The server finds the message in the table's own copy of recent chat and stores that text
  and the author. A client cannot submit invented text or a different author.
- **Reports are not sent to other players** and do not change the table.

## Validation and limits

| Rule | Value | Enforced in |
| --- | --- | --- |
| Report reasons | `harassment`, `hate`, `threats`, `sexual`, `spam`, `other` | `lib/moderation.js`; database `CHECK` |
| Report details | cleaned of control characters, at most 300 characters | `lib/moderation.js` |
| Reported text kept | at most 200 characters, the server's copy | `db/moderation.js` |
| Report cooldown | one per account every 3 seconds, shared by its sockets | `server.js` `report` |
| Reports per reporter per day | 20 | `db/moderation.js` (database count, in one transaction) |
| Duplicate report | the same reporter cannot report the same message twice | database unique key |
| Block cooldown | one per account every second, shared by its sockets | `server.js` `block` |
| Unblock cooldown | one per account every second, shared by its sockets; no-op unblocks are ignored without a database write | `server.js` `unblock` |
| Blocks per account | 500 | `db/moderation.js` (row-locked count) |
| Cannot block yourself | refused | `lib/moderation.js` |
| Block target | must be an existing account id | format check, then a foreign key |
| Chat cooldown (existing) | one message every 500 ms | `server.js` `chat` |

## Data

Migration `010_chat_moderation.sql` adds two tables. It is additive, and it is applied when the server starts, like the
other migrations.

- `player_blocks(blocker_id, blocked_id)`: who blocked whom.
- `chat_reports(reporter_id, reported_id, reported_display_name, room_code, message_id, message_text, reason, details, created_at)`.

Blocks reference `players` with `ON DELETE CASCADE`. Chat reports use separate deletion rules:
`reporter_id ON DELETE CASCADE` removes reports made by an account that is deleted, while
`reported_id ON DELETE SET NULL` preserves reports made against a deleted account. Migration
`015_chat_report_retention.sql` adds `reported_display_name`, a snapshot captured at report creation; the account UUID is
cleared on deletion, but the report text, reason, details, room and timestamp remain for moderation review.

## Reviewing reports

There is no review screen. Reports are read directly from the database, by an operator with access to the database.
Example query (review the most recent reports, nothing else):

```sql
SELECT created_at, reason, details, message_text, reporter_id, reported_id, reported_display_name, room_code
FROM chat_reports
ORDER BY created_at DESC
LIMIT 50;
```

A decision to remove a player's access is a manual action taken outside this feature.

## Known gaps

- **Lobby and table listings still show a blocked player's name.** Blocking hides them from chat, voice, reactions,
  friend requests and invitations; it does not remove them from the public table list.
- **There is no screen to unblock.** The `unblock` action exists and is tested; a settings screen is a follow-up.
- **There is no review queue or admin tool.** Reports are stored for manual review only.
- **Reports against deleted accounts are retained** with a display-name snapshot and no account UUID. Reports made by a deleted reporter are removed. No retention period is enforced yet.
- **The block list is cached in memory per server.** The server runs as a single instance, so this matches the rest of the
  table state. A future multi-instance setup would need the cache moved or invalidated.
- **Cooldowns are per account on each server, not per socket.** Opening more sockets does not give more cooldowns. The
  cooldowns reset if the account's in-memory record is dropped after an hour offline, which is harmless: the daily report
  cap and the block cap are counted in the database. A person can still create more accounts, which is limited separately
  by the per-IP and site-wide account creation limits.
