# Chat moderation and abuse protection

This is the minimum needed to report abusive table chat and block another account across table access and social surfaces. It is enforced on
the server. It does not replace human review, and it does not take automatic action against anyone.

## What a player can do

| Action | Where | Effect |
| --- | --- | --- |
| **Block** an account | Block action on another player's chat message | Their table chat and table voice are hidden between you. You cannot invite each other, and their profile shows as blocked. You can still share a table, including one hosted by someone else. |
| **Report** a message | Report button, then a reason | Records the report in the database. There is no review queue yet. Nothing is hidden or sanctioned automatically. |
| **Report** a player | Report player, on their table card (signed-in accounts only), then a reason | Records a player report (`player_reports`, migration 023). It is about conduct, not one message, and counts toward the same daily cap. One report per reporter and player; a repeat is ignored. Nothing is hidden automatically. |
| **Unblock** | WebSocket action `unblock` (no button yet) | Restores their chat. |
| **Mute** (local) | Existing mute in the chat list | Hides that player's messages in this browser only. Not enforced on the server. |

## Enforcement

- **Blocks are applied on the server.** When a socket joins, the server loads the account's blocked ids and keeps them on
  the player. Live chat (`pushChat`) and the history sent on join or reconnect both pass through
  `lib/moderation.js` `shouldDeliver` / `visibleChat`, so a blocked message is never sent to the blocker's socket. A pending block is filtered immediately while its database write is queued or in flight.
- **Chat filtering is one way.** When A blocks B, B's messages are not delivered to A. B can still receive A's messages during an already-running game, and B is not told about the block.
- **Chat is one way; voice is two ways.** The blocker stops receiving the blocked player's table chat. The blocked player still receives the blocker's chat. Voice is blocked in both directions. (Decided by the owner, 2026-11-10.)
- **A host may keep a blocked guest at the host's own table.** The block does not remove the guest, and the guest is not told. The host decides who stays at a table they host, and the block is not a reason to remove anyone. (Decided by the owner, 2026-11-10.)
- **The profile of a blocked player shows a 'Blocked' label to both sides.** The lookup is symmetric, so the blocked player can see that a block exists on the profile. This is kept as it is (owner decision, 2026-11-10).
- **A block never changes table access.** A blocked pair may join, sit, spectate and reconnect at any table, including a table hosted by a third person, and an invitation from that host can reach both. A block never removes anyone from a table, and the host of a table can be blocked by a player at it. Only the chat and voice rules below apply at a shared table.
- **Voice and reactions are blocked in both directions.** A block in either direction keeps the pair out of each other's
  table voice: each browser is offered only the people it may hear, so an existing connection to the other person closes.
  A signal between them is refused with the same answer as "not in voice", and reactions are not delivered either way.
  Friend requests and private-table invitations between the two are refused across a block (`db/friends.js`).
- **Profiles show as blocked.** A blocked viewer still gets the profile, with a "Blocked" label and no friend action. Nothing else about the profile is hidden. Friend search still does not list a blocked account (`db/friends.js`).
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

Migration `010_chat_moderation.sql` adds two tables. Migration `015_chat_report_retention.sql` adds the reported-name
snapshot and changes the reported-account reference; both are additive and applied when the server starts.

- `player_blocks(blocker_id, blocked_id)`: who blocked whom.
- `chat_reports(reporter_id, reported_id, reported_display_name, room_code, message_id, message_text, reason, details, created_at)`.

The reporter reference uses `ON DELETE CASCADE`: reports made by a deleted reporter are removed. The reported-account
reference uses `ON DELETE SET NULL`: reports against a deleted account remain with the server-captured display-name
snapshot and report content, but without the deleted account UUID. This applies to individual account deletion paths.
The separate full-database cleanup command intentionally empties the entire `chat_reports` table, as shown in
`docs/DATA_CLEANUP.md`; it does not preserve moderation evidence. The cleanup schema guard (`db/cleanup.js`) classifies
both foreign keys so either account-deletion behavior is explicit.

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

- **There is no unblock screen yet.** The unblock action exists and is tested; a settings screen is a follow-up.
- **There is no review queue or admin tool.** Reports are stored for manual review only.
- **Reports are retained when the reported account is deleted**, but reports made by a deleted reporter are removed. No independent retention period is enforced yet.
- **The block list is cached in memory per server.** The server runs as a single instance, so this matches the rest of the
  table state. A future multi-instance setup would need the cache moved or invalidated.
- **Cooldowns are per account on each server, not per socket.** Opening more sockets does not give more cooldowns. The
  cooldowns reset if the account's in-memory record is dropped after an hour offline, which is harmless: the daily report
  cap and the block cap are counted in the database. A person can still create more accounts, which is limited separately
  by the per-IP and site-wide account creation limits.
