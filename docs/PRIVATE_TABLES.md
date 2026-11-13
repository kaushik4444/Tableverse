# Private tables: who may be at the table

This is the rule the server enforces (`canEnterRoom`, `onFriendRemoved`, `enforceAccess`, `revokeAccess` in `server.js`;
`canJoinPrivateRoom` in `db/friends.js`) and the tests in `tests/private-table-access.pg.test.js` check.

## New tables are public by default

A table created without a visibility is **public** (`visibilityForNewTable` in `lib/roomAccess.js`). The Create table button asks
for a public table. A public table is listed in the open-tables list while it is in the lobby or running, and anyone can join it.

- `visibility: 'private'` in a create request makes a private table. The host can also use **Make private** at any time from the
  table screen. Private tables are not listed and need an accepted invitation (rules below).
- An unknown visibility value (anything other than `public` or `private`, for example `PUBLIC`) makes a **private** table. An
  unknown value never makes a table public.
- Tables that already exist are not changed by this default: tables live in memory and the rule is read only when a table is created.
- Tests: `tests/public-default-tables.test.js` (the rule, the button, and the open-tables list) and `tests/private-tables.test.js`
  (private access).

## Who has access

| Person | Access to a private table |
| --- | --- |
| The **creator** (opened the table) | Always. A friendship change never removes them. |
| The **current host** | Always. A host is never thrown out of the table they run. |
| Anyone **who was already here when a public table was made private** | Kept (they were let in as public guests). Newcomers are not. |
| **Everybody else** | An **accepted** invitation from the creator or from anyone who has hosted this table, **and** that friendship still exists. |

The database is the authority. Being seated is **not** a pass: every entry (join, sit, reconnect, rematch) re-checks it.
Only the three exceptions above are remembered in memory (`creatorId`, `hostId`, `admitted`).

Invitations can be created by anyone seated at the table while it is a lobby (not only the host). A declined invitation tells the inviter, and anyone seated can send it again; a member who invited someone counts as an inviter, like a past host, so that invitation stays valid after they leave. An accepted invitation survives a host change:
guests are not thrown out because the person who invited them stopped hosting. It does **not** survive the end of the friendship
(`removeFriend` revokes every pending and accepted invitation between the two people).

## What happens when a friendship ends

Either person can end it. The server looks at **both** of them wherever they are. It does not matter whether the inviter is the
current host, a previous host, or has already left the table. Anyone who now has no other valid path in is handled like this:

| Where they are | Result |
| --- | --- |
| In a **lobby** (seated or watching) | Removed immediately, with a notice. |
| **Watching** a running game | Removed immediately (this cannot affect the game). |
| **Seated in a running game** | May **finish that game** (a friendship change must not abort other people's game). They get a notice. They are marked: they cannot come back. |
| At a **finished** table | Removed immediately. If they were marked during the game, they are removed when the host starts the **rematch**. |
| Not at the table | Cannot join, sit or rejoin. The home screen does not offer "Rejoin". |

Re-entry is where the protection ends: if a marked player **reconnects** (new socket) they are refused, leave the table, and a bot
takes their seat in a running game (they are not left behind as a ghost player who stalls the game). The next rematch removes anyone
still marked. Becoming friends again does not bring back an old invitation (it stays revoked); the host sends a new one.

An invitation's **expiry** only stops *new* entries. Someone already seated is not removed (or refused a reconnect) because their
invitation timed out; if they leave, coming back needs a valid invitation.

## Removed by the host

A player the host removes with the host tools (`kick`) is recorded in `room.removed` and is refused at this table for good, whatever
invitations they hold. That is separate from friendship and checked first in `canEnterRoom`.

## Spectators

Watching is a choice and never turns into playing on its own. After a finished game the host's **rematch** keeps spectators as
spectators even when seats are free; they take a seat themselves with **Sit** (lobby only). The one deliberate exception is
unchanged: if the last human leaves an empty *lobby*, the first spectator inherits the table instead of it closing.

## Presence (friends list, `socialPresence`)

A friend sees only: online / offline, last seen, **which game** they are playing (`playing: "wizard"`) and their ping.
It never includes a table code, who they sit with, or whether a table is private. Presence is computed on demand from this server's
memory plus the friendship list, so it only ever reaches the person's own friends.

**Limitation (not changed here): presence and tables are per server process.** Rooms, sockets and presence live in memory. With
more than one server instance, a friend who is on another instance looks offline, and a friendship removed on instance A can only
evict people at tables hosted on instance A immediately. Instance B enforces the same rule at the next entry (reconnect, join,
rematch) because it re-checks the database. Running several instances needs shared presence and a way to publish "friendship ended"
events between them; that is not built.

## Known limits of this policy

* A player who keeps a live connection and a seat in a running game can keep chatting at the table until it ends (they are not muted).
* A host who also stopped being friends with a guest keeps hosting; the guest is removed. Hosting a table is not tied to friendship.
* An empty lobby inherited by a spectator makes that spectator the host (the host always has access).
