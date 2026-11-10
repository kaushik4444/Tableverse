# Session policy

This document describes how login sessions behave today. It records the existing behaviour; it does not change it.

## One active session per account

Each account has at most one active session at a time.

- **Login revokes the older sessions.** When a player logs in, `createSession` (`db/auth.js`) marks every other unrevoked session for that account as revoked in the same transaction, then inserts the new one.
- **Older devices are signed out live.** The login route calls `onSignedOut` with the new token as `exceptToken`. Any open game socket that belongs to an older session is closed with code `4002` ("signed in elsewhere"), so that device sees the message immediately instead of at its next request.
- **Sign-out ends the sessions it names.** `logout` ends the current session and closes its socket with `4001`. `logout-all` and a successful password reset end every session of the account and close those sockets with `4001`. Account deletion closes the account's sockets with `4001` as well.
- **Registration never creates a session.** Creating an account, for a new or an existing address, issues no session cookie and no session row. The user verifies their email and then logs in. This is what keeps the registration answer the same for both cases.
- **Expired or revoked sessions are rejected when a socket joins.** The `hello` handler checks the database for the session, even when the token is in the in-memory cache, so a revoked session cannot keep playing from the cache.

## Lifetime

- The database row expires after `AUTH_SESSION_TTL_DAYS` days (default **30**).
- The `ct_session` cookie uses the same value as its `Max-Age`.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

## Consequences to know about

- Signing in on a second device signs out the first one. This is intentional.
- Two tabs in one browser share one cookie, so they share one session; this is not a second device.
- A moderation or abuse action (see `docs/CHAT_MODERATION.md`) never changes this policy. Blocking hides chat; it does not sign anyone out.

## Keep me signed in on this device (Stage 20.9)

- A login with **"Keep me signed in on this device"** ticked also issues a device token, in the `ct_device` cookie. It is random, HttpOnly, sent only to `/api/auth` (`Path=/api/auth`), and never across sites (`SameSite=Lax`). Its SHA-256 hash is stored in `auth_devices` with a short label such as "Chrome on Windows" (browser and system only, never the full user agent or an address).
- When the page starts without a live session, the server starts a session from a valid device token. The same checks as a login apply: the account must be registered and not suspended. The one-session rule applies too, so the older session of the account is retired and its open connections close.
- The device lasts 30 days and each use slides that forward: a visit that starts a session from it, and a visit with a live session, both renew the device and its cookie. A device not used for 30 days after it ends is removed by the housekeeping.
- A password login replaces the device the browser already had: the token it sent stops working at once. A login without the box ticked clears the cookie.
- Issuing a device happens under the account lock, the same lock sign-in, sign-out, reset and suspension take. Restoring a session checks the device again under that lock. Each revocation (logout, sign-out everywhere, reset, owner sign-out, suspension) ends sessions and devices in one transaction.
- Trust ends: on that device's sign-out; on sign-out everywhere; on a successful password reset; on an owner sign-out; and on a suspension. Lifting a suspension does not bring the devices back.
- The box is not ticked by default, and the page says "Only on a device you own."
- Without PostgreSQL (memory mode) there is no device trust.

Not yet built: a list of trusted devices with a per-device "forget" button in account settings. Sign-out everywhere already ends all of them.

## Where this is enforced

| Behaviour | Location |
| --- | --- |
| Revoke older sessions on login | `db/auth.js` `createSession` |
| Close older sockets | `server.js` `onSignedOut`, called from `lib/authRoutes.js` |
| No session at registration | `db/auth.js` `registerEmail`; `tests/register-no-session.test.js`, `tests/enumeration.pg.test.js` |
| Single session across login and reset | `tests/session.pg.test.js`, `tests/db.pg.test.js` |

Changing this policy is a product decision. Do not change it as a side effect of another change.

## Login throttling (Stage 20.3.5 Task C)

- Only failed logins count. A successful login gives its attempt back, so a player who signs in often is never throttled.
- Each attempt reserves one count on two counters before the password is checked, so concurrent guesses cannot slip past the limit together:
  - per address and account (`RL_LOGIN_EMAIL_LIMIT`, default 8 per 15 minutes): a wrong guess against one account from one place. A different account, or the same account from another address, is not locked out.
  - per address in total (`RL_LOGIN_IP_LIMIT`, default 25 per 10 minutes), across all accounts.
- A server fault (for example, the database is down) gives its attempt back, so an outage does not lock players out.
- Password recovery and resend-verification have their own counters and are never blocked by failed logins.
- A refused login gets the same answer whether or not the account exists.
- Known limitation: an attacker who spreads guesses across many addresses is limited only by the per-IP and per-account-address counters. A cross-address counter per account would stop that, but it would let one attacker lock the owner out, so it is a product decision and is not made here.

## Sessions (Stage 20.3.5 Task C)

- Every session has an expiry date. Migration 011 revoked the older sessions that had none; players sign in again once. Nothing is deleted.
- A malformed session token is refused before the database is asked.
- A password reset and a login cannot both succeed: the login re-checks the password under the same account lock the reset takes, so a session is never issued for a password that has just been replaced.
- Each open WebSocket re-checks its session every 60 seconds (`sessionCheckMs` in the server options; not an environment variable). A revoked or expired session ends its socket with code 4001 and a notice to sign in again. Sign-out, login from another device, password reset and account deletion end the socket at once, on the instance that handled the request.
- Limitation: when another instance revokes a session (for example, a sign-out there), an open socket here ends within the check interval, not at once. A message sent after the socket is marked as revoked is never acted on.
- The session and logout routes are rate limited per address (`RL_SESSION_IP_LIMIT`, default 120 per 10 minutes; `RL_LOGOUT_IP_LIMIT`, default 60 per 10 minutes).

Operator notes: the new limits and the session check are on by default and need no environment change. Migration 011 runs with the normal deploy migration; it changes only sessions that had no expiry date.
