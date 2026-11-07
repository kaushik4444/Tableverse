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

## Where this is enforced

| Behaviour | Location |
| --- | --- |
| Revoke older sessions on login | `db/auth.js` `createSession` |
| Close older sockets | `server.js` `onSignedOut`, called from `lib/authRoutes.js` |
| No session at registration | `db/auth.js` `registerEmail`; `tests/register-no-session.test.js`, `tests/enumeration.pg.test.js` |
| Single session across login and reset | `tests/session.pg.test.js`, `tests/db.pg.test.js` |

Changing this policy is a product decision. Do not change it as a side effect of another change.
