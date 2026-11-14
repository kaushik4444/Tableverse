# Admin console, analytics, feedback and announcements (Stage 20.5)

Everything here is lightweight and free-beta friendly: no external services, no new dependencies, no paid features.
The console lives at `/admin.html` (linked from the account menu for staff only). **The page is only a display.** Every
`/api/admin/*` request is authorised on the server: session cookie, role read from the database, CSRF token.

## Roles

| Role | Can |
|---|---|
| `owner` | Everything an admin can, plus grant and remove the `admin` role, sign accounts out of every device, suspend and lift suspensions of ordinary accounts, and send e-mail. Exactly one account. |
| `admin` | See the console, look accounts up, manage announcements and feedback, resend verification e-mail to ordinary players. Cannot sign anyone out, suspend anyone, or touch the owner or other admins. |
| `user` | Nothing in the console. |

Protections (each is covered by `tests/admin.test.js` or `tests/admin.pg.test.js`):

- The role is stored in `players.role` and read from the database on **every** admin request, so a demotion applies to the next request. Nothing a client sends (body, query, header, cookie) is ever treated as a role.
- The database allows **one** owner (unique partial index) and only `user` / `admin` / `owner` (CHECK).
- Only the owner can change roles. The API can only grant `admin` or `user`: **ownership can never be granted through the API.** The owner row cannot be changed, not even by the owner (the SQL `UPDATE ... WHERE role <> 'owner'` repeats the rule), and nobody can change their own role.
- Role changes lock both accounts and write their audit row in the **same transaction**.
- The owner account cannot be deleted through `/api/me/delete-account` (answers 409), so the console cannot be orphaned by accident.
- Every admin POST goes through the same CSRF double-submit check as the rest of the auth API (`lib/authRoutes.js`), and every admin call is rate limited per address and per account.
- Anonymous callers get 401. A signed-in non-admin gets 403 and no data.

### Setting up the owner (server-side configuration only)

Set one of these on the server (for example in the Render dashboard; nothing is committed and `render.yaml` is unchanged):

- `ADMIN_OWNER_EMAIL`: the e-mail address of your existing account. Tried **first**. Only a **verified** address qualifies, so nobody can claim ownership by registering your address first.
- `ADMIN_OWNER_ID`: the owner's stable account id (UUID). Used as the **fallback** when the e-mail setting is not set or does not match a verified account. Either setting works on its own.

The account becomes the owner the first time it is known to the server while **no owner exists**: at start-up, or when that signed-in account first opens the console. Once an owner exists nothing else can claim it, whatever the settings say: changing or removing the settings has no effect. The claim is written to the audit log (`owner.claimed`). Without either setting there is no owner and nobody can become one.

Handing ownership to someone else is deliberately not an API feature. It is an operator action on the database (demote the old owner and promote the new account in one transaction); ask before doing it in production.

## Analytics

Privacy-conscious by construction:

- **Counters only**: per day, per metric (`registration`, `login`, `session`, `game_started`, `game_finished`, `error`, `feedback`) and a short dimension such as a game id or an error kind. There is no per-event log.
- **No** IP address, user agent, name, e-mail, chat or table content is recorded. Dimensions are lowercased and limited to `a-z 0-9 _ . : -` and 48 characters.
- **Active users** are distinct accounts per day stored as `HMAC-SHA256(salt, account id)` cut to 32 hex characters, never as an id. The salt is server-side (`analytics_meta`). Guests are not counted as active users.
- **Non-blocking**: `track()` only adds to an in-memory buffer; a timer writes it in batches every 15 s. If the database is slow or down the buffer is kept (bounded: 2000 counters, 5000 active accounts), retried, and past the bound new counts are **dropped and counted**, never queued without limit. Every write carries a random batch key, recorded in `analytics_batches` in the same transaction as the write. A write that hangs times out after 5 s; a timed-out or failed batch is sent again **with the same key**, so a write that did land is ignored and nothing is counted twice. A flush that is called while another runs waits for it, so counts added in the meantime are written too. Shutdown waits at most 2 s for a final write, and a stuck write never holds the process open. Analytics failures are visible on the Health tab and never affect a request.
- Turn it off with `ANALYTICS_ENABLED=0`.

### Retention and deletion

| Data | Kept | How it is removed |
|---|---|---|
| `analytics_active` (hashes per day) | 35 days | daily housekeeping (`db/admin.js purge`, every 6 h) |
| `analytics_daily` (aggregate counters) | 400 days | same |
| `admin_audit_log` | 365 days | same |
| `feedback` | 180 days | same |
| `announcements` (and their dismissals) | 90 days after they end (from the early end, if an admin ended it) | same |
| `analytics_batches` (write keys) | 3 days | same |
| An account's activity hashes | until the account is deleted | pending activity is dropped from memory first, then the stored hashes are removed (`analytics.forget`, `forgetActor`) |
| Activity | once per UTC day | marked at the first authenticated message of each day, not only at login, so a session open across midnight counts for the new day |
| Feedback text of a deleted account | until the retention period | the link to the account is cleared (`ON DELETE SET NULL`); the text stays, so do not put personal data in feedback (the form says so) |
| Audit entries of a deleted admin | until the retention period | the actor shows as "removed account" |
| Everything | on demand | `npm run cleanup:users` also empties all of these tables (see [DATA_CLEANUP.md](DATA_CLEANUP.md)) |

Deleting `analytics_meta.salt` makes every stored hash unlinkable (a new salt is created on demand).

## Announcements

Admins publish banners from the **Announcements** tab: text (200 characters), style (info / warning / good news), audience (everyone, signed-in players, guests, admins) and a schedule. **Presets: 1 hour, 1 day, 1 week**, or custom start and end. Every banner has an end (at most 90 days) and a start at most 180 days ahead; a banner whose end has passed cannot be created. Admins can end a banner early or edit a running one; finished banners cannot be edited. An edit changes only the fields it sends: sending just a new end time keeps the start, and the whole window (start, end, length) is checked against the stored banner before it is saved.

How it behaves (covered by `tests/announcements.test.js`, `tests/admin.pg.test.js`, `tests/ui/admin-ui.js`):

- **Expiry and start are decided on the server** on every request, so a banner disappears exactly at its end even though the live list is cached for up to 15 s. A scheduled banner appears at most 15 s after its start. Open pages look again every minute and when the tab becomes visible.
- **Targeting** is decided from the session on the server; nothing the browser sends can change the audience.
- **Dismissal across devices**: a signed-in player's dismissal is stored on the account (`announcement_dismissals`), so it holds on every device. Guests have no account, so a guest dismissal is remembered in that browser only.
- **Revisions**: every banner has a revision. An edit that changes what players see (text, style, audience or schedule) makes a new revision, and a dismissed banner shows again. Saving the same values again is not a change, so dismissals stay. Restoring an earlier text is a change too.
- **Stale copies**: the live banner list is cached for up to 15 seconds per server instance (`ANNOUNCEMENT_CACHE_MS`), so one instance may still send an older revision after another instance recorded a dismissal. A dismissal of revision N therefore hides revision N and every older revision of that announcement; only a revision newer than N is shown. The same rule applies to guests' browser dismissals.
- A signed-in dismissal records the revision the player saw, so a dismissal that arrives after an edit hides only the text that was read, and a newer dismissal is never lowered by an older one. Guests keep their dismissals in their browser under their own key (`ct_ann_rev`), at most the 50 most recent banners; dismissing a newer revision of a banner counts as its most recent dismissal, so it is not the entry trimmed. Entries the earlier format wrote (`id:text`) under the old key are never read (and the key is removed); so those banners show once more, because an edit made after such an entry was written cannot be told apart from an unedited banner.
- At most three banners show at once (warnings first).
- **`ANNOUNCEMENT` environment variable still works**: the existing single banner (and its `ct_ann` dismissal) is unchanged and shows alongside the managed ones.

## Feedback

Everyone (guests included) can send feedback from the account menu or `POST /api/feedback` (CSRF-protected, 1000 characters, rate limited per address and per account). The account is taken from the session, never from the request. Staff triage it on the **Feedback** tab (new / read / resolved).

## Chat report queue (read-only)

The **Reports** tab lists every report, chat reports and player reports (from a card or a profile), newest first, 25 per page. For each report it shows the reason, a severity fixed by the reason (threats and sexual content high, harassment and hate medium, spam and other low), the message copy kept with a chat report (a player report has none, and says it came from a card or profile), the room, the reporter's and the reported account's usernames, whether the reported account is suspended, and how often that account has been reported (all time, and in the last 30 days). A reported account that has been deleted shows its last recorded display name. No e-mail address, network address or token is selected. Each time the queue is opened, one `reports.view` row is written to the audit log; it holds no report content. Resolving reports is not built yet.

## Suspension and lookup (Stage 20.8)

- **Suspend** (owner only, ordinary registered accounts only; never the owner, an admin, a guest or the owner's own account): the account's sessions end at once, its open connections close, and sign-in is refused with "This account is suspended." Existing sessions stop working because every session check also requires the account not to be suspended. The reason is optional, kept to 200 characters, cleaned of line breaks, and stored on the account and in the audit log. Staff who can use the lookup, and staff who can read the audit log, can see the reason, so it must not hold anything confidential.
- **Lift** (owner only): sign-in works again. Sessions that ended stay ended; the player signs in again.
- **Sign out** of every device is owner only.
- **Lookup** (staff): exact username. Shows role, verified state, dates, active session count and suspension state. Never an e-mail address, a network address or a token.

## Audit log

Every state change in the console (role changes, sign-outs, feedback status, announcement create / edit / end, owner claim) is written to `admin_audit_log` in the same transaction as the change. It stores who (account id), what, which target and small details. No IP address. There is no API to edit or delete entries; only retention removes them.

## E-mail broadcasts (Stage 20.7, owner only)

The owner can e-mail a chosen group from the **E-mail** tab. Only the owner sees the tab, and the server refuses every other account on each call.

- **Who:** everyone with an address; verified accounts; unverified accounts; admins and the owner; ordinary players; inactive accounts (no login for 30 days).
- **Kind:**
  - **Account e-mail** (service notices): goes to the chosen group, including unverified accounts. No unsubscribe link, because it is not marketing.
  - **Promotion or greeting** (offers, seasonal messages, comeback mail): only to **verified** accounts that have not opted out. Every message has a one-click unsubscribe link and a `List-Unsubscribe` header. An unverified audience cannot be combined with this kind (refused).
- **Two steps:** "Check recipients" shows the current count. The owner types that number, and only then can the send be queued. If the list has changed since the check, the server refuses the send (409) and asks for a new check.
- **Delivery:** the queued send is fixed to the recipients chosen at queue time. A background worker sends in batches of 20 with a pause between batches, once a minute and straight after queuing. It reads each address when it sends and skips a promotional mail for an account that has opted out since. A failed delivery is recorded as failed and does not stop the rest. A restart resumes a send that was half done. The provider's idempotency key stops a retry repeating a delivery. One server instance sends at a time.
- **Limits:** subject up to 160 characters on one line, message up to 5000 characters (escaped; the text is never HTML), at most 20 queued sends per day (`RL_BROADCAST_LIMIT`).
- **Records:** the audit log holds who queued what, the audience, the kind and the count, never the message text. The history table shows status, counts and the subject. The addresses are not stored in the broadcast tables; recipients are account ids, and the address is read from the account when mail is sent.
- **Unsubscribe:** `GET /api/email/unsubscribe?token=` (public, rate limited per address). The token is random per account and is the only thing the link carries. Every answer looks the same, so a token cannot be tested for existence. Account e-mail is not affected by an opt-out.
- **Configuration:** the mail provider must be set up (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`). Promotional mail also needs `PUBLIC_APP_URL`, because the unsubscribe link is built from it; without it a promotional send is refused (503).

## API summary

All under the session cookie. `POST` needs the `X-CSRF-Token` header. Staff = admin or owner.

Overview charts (staff): a 7, 30 or 90-day range, active players per day and registrations per day as line charts. Each chart has a data table underneath. The counts come from the same counters as before: no names, addresses or messages.

Logs (staff): `GET /api/admin/logs?level=&component=&event=&limit=` returns the recent lines of this server process since its last restart. Lines are redacted before they are kept (`lib/log.js`), the buffer is bounded (500) and in memory only. Render's log view keeps the full history; this tab does not replace it. The overview also counts chat reports (last 7 days and total) and feedback not yet read.

Resend verification (staff): `POST /api/admin/users/resend-verification` with `{playerId}` sends the verification email again to an account that has not verified yet. The address is read on the server and never returned to the browser. The response is `{ok, sent}`. A verified account or one without an email gets 409. Each account can be sent this at most 3 times an hour (`RL_ADMIN_RESEND_LIMIT`). The audit row `user.verify_resend` records the attempt, not the address. Sending to everyone at once is not built yet.

| Endpoint | Who |
|---|---|
| `GET /api/admin/me` | any signed-in account (says whether you are staff) |
| `GET /api/admin/overview?days=`, `/health`, `/users?q=&page=`, `/feedback?status=&page=`, `/announcements`, `/audit?page=`, `/logs` | staff |
| `POST /api/admin/users/sign-out` | owner |
| `POST /api/admin/users/suspend`, `/users/unsuspend` | owner (ordinary registered accounts only) |
| `GET /api/admin/users/lookup?username=` | staff (read-only; never an address, network address or token) |
| `GET /api/admin/reports?page=` | staff (read-only chat report queue; opening it is audited as `reports.view`) |
| `POST /api/admin/users/resend-verification` | staff (admins only on ordinary players) |
| `POST /api/admin/roles` | owner |
| `GET /api/admin/broadcasts`, `GET /api/admin/broadcasts/preview?audience=&category=`, `POST /api/admin/broadcasts` (`{audience, category, subject, body, expectedCount}`) | owner |
| `GET /api/email/unsubscribe?token=` | everyone (public, answered the same for every token) |
| `POST /api/admin/feedback/status`, `/announcements`, `/announcements/update`, `/announcements/end` | staff |
| `GET /api/announcements`, `POST /api/announcements/dismiss`, `POST /api/feedback` | everyone / signed-in / everyone |

## Environment variables

`ADMIN_OWNER_ID`, `ADMIN_OWNER_EMAIL` (owner bootstrap), `ANALYTICS_ENABLED` (`0` disables). E-mail: `PUBLIC_APP_URL` (needed for promotional mail), `RL_BROADCAST_LIMIT` (queued sends per owner per day, default 20), `RL_UNSUBSCRIBE_IP_LIMIT`. Rate limits can be tuned with `RL_ADMIN_IP_LIMIT`, `RL_ADMIN_PLAYER_LIMIT`, `RL_ANNOUNCE_IP_LIMIT`, `RL_FEEDBACK_IP_LIMIT`, `RL_FEEDBACK_PLAYER_LIMIT`. `ANNOUNCEMENT_CACHE_MS` changes the 15 s banner cache (tests use 0).

## Not included (limits of the free beta)

- No owner transfer in the UI, no two-factor step for admins, no e-mail alerts.
- Multi-instance: the 15 s banner cache is per instance (fine for one Render instance; at most 15 s of delay across several).
- Analytics counts a session per WebSocket connection, so a reconnecting player counts again.
- The PostgreSQL suites (`tests/admin.pg.test.js`, the `test:pg` run) are the authority for the database parts. They are wired into `npm run test:pg` and CI; see PROGRESS.md for what has been run locally and what has not.

## Visits by hour and visit length (Insights)

The game server counts, per day, how many connections opened in each UTC hour (`session_hour`) and how long each connection lasted, in five buckets (`session_len`: under 1 min, 1-5, 5-15, 15-60, over 1 h). Both are aggregate counters in `analytics_daily` (kept 400 days like the others); no account, address or device is attached. A visit is one WebSocket connection, so a reconnect is a new visit, and connections shorter than 3 seconds (health checks, flapping) are in neither counter. A visit is counted when it ends, under the UTC hour it opened in. The console shows the hour counts in the chosen zone using that zone's offset today. Counting starts when this feature is deployed.
