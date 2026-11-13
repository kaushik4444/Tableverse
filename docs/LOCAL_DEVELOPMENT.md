# Local development

How to run Tableverse on your own computer, create a test account and open the admin console, without touching the
production database or any paid service.

## What works without a database, and what does not

| | No `DATABASE_URL` | Local PostgreSQL |
|---|---|---|
| Guest play (Play as guest) | yes (in-memory) | yes |
| **Register / log in with e-mail** | **no**: the server answers 503 "Email authentication requires PostgreSQL" | yes |
| Friends, stats, admin console | no | yes |

That 503 is why e-mail login "does not work" on a fresh checkout: accounts live in PostgreSQL, and the in-memory mode only
supports guests. `REQUIRE_EMAIL_VERIFICATION=false` works as the README says (registration then says "You can log in now;
verification is optional right now"), but only once a database exists. No mail service (Resend) is needed locally: when no
provider is configured the verification e-mail is simply not sent.

## One-time setup

You need Node.js 20 or newer (22 is what production runs) and either Docker or a local PostgreSQL 14+.

```bash
npm ci
cp .env.local.example .env.local        # Windows: copy .env.local.example .env.local
```

Start a throw-away PostgreSQL that listens on this computer only:

```bash
docker run -d --name tableverse-pg -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=tableverse_dev \
  -p 127.0.0.1:55433:5432 postgres:16
```

(Already have PostgreSQL? Create an empty database and put its URL in `.env.local`.) The URL in `.env.local.example`
matches the command above.

## Create a test account (and a local admin)

```bash
npm run dev:seed -- --email me@local.test --username localme --owner
```

It runs the database migrations, creates a verified account and prints a **generated password once**:

```
Created local test account
  e-mail:    me@local.test
  username:  localme
  role:      owner
  password:  Kf7!qWm2#zPb9-Xr4Tc_   (shown once; it is not stored anywhere readable)
```

- `--owner` makes it the owner of this local database, which unlocks the admin console. Leave it out for an ordinary account.
- Run it again with the same e-mail to keep the account; add `--reset-password` to get a new password if you lost it.
- The e-mail address never leaves your computer; `.test` / `.local` addresses are fine.
- There are no built-in credentials: every password is generated, and the repository contains none.

## Run the app

```bash
npm run dev
```

Open <http://localhost:3000>, choose **Log in**, and use the e-mail and password from the seed command.

`npm run dev` loads `.env.local`, checks the database, makes e-mail verification optional, and starts the server with only that
checked environment. `npm start` does not read `.env.local` or `.env`: the server never reads a file itself. Use `npm run dev` for
local work.

## Open the admin console locally

1. Create the account with `--owner` (above) and log in at <http://localhost:3000>.
2. Open <http://localhost:3000/admin.html> (or the Admin link in the account menu).

The owner role is read from the local database on every admin request; there is no admin switch in the browser, and nothing
in this workflow exists in production. In production the owner is set on the server with `ADMIN_OWNER_EMAIL` / `ADMIN_OWNER_ID`
(see `docs/ADMIN.md`). A local database can have only one owner; to start over, remove the container
(`docker rm -f tableverse-pg`) and repeat the setup.

## Safety rules (enforced in code, covered by tests)

- `npm run dev` and `npm run dev:seed` **refuse `NODE_ENV=production`**.
- They **refuse any database that is not on this computer**: managed hosts (Neon, Render, Supabase, AWS ...) are refused outright,
  and any other remote host needs an explicit `ALLOW_REMOTE_DEV_DB=1`. Never point `.env.local` at the production database.
- Passwords are generated with a cryptographic random source and meet the same password rule as real sign-ups.
- The seed code is never loaded by the server, so it cannot be reached from the running app.
- `.env.local` is in `.gitignore`. Only `.env.local.example` (no secrets) is committed.
- The automated tests use their own throw-away databases (`TEST_DATABASE_URL`, see the README) and never `DATABASE_URL`.

## Troubleshooting

| You see | Cause and fix |
|---|---|
| "Email authentication requires PostgreSQL" (503) | There is no `DATABASE_URL`. Start the database and fill `.env.local`, then use `npm run dev`. |
| `[dev] Refusing to use ... managed ... database` | `.env.local` or your shell points at Neon/Render. Use the local database URL. |
| `connect ECONNREFUSED 127.0.0.1:55433` | The database container is not running: `docker start tableverse-pg`. |
| "Invalid email or password" right after seeding | The password was shown once. Run the seed command again with `--reset-password`. |
| "Please verify your email" | `REQUIRE_EMAIL_VERIFICATION` is `true` in your shell or `.env.local`. Set it to `false`; seeded accounts are already verified. |
| `EADDRINUSE` | Port 3000 is taken: set `PORT=3100` in `.env.local`. |
| Admin console says "forbidden" | The account is not the owner. Seed with `--owner` (only works while the local database has no owner). |

## Tests

```bash
npm test               # unit tests (PostgreSQL suites skip without TEST_DATABASE_URL)
npm run test:ui        # browser tests (Playwright)
TEST_DATABASE_URL=postgres://postgres:devpassword@127.0.0.1:55433/postgres npm run test:pg
```

`test:pg` creates and drops its own databases; see the README, "Testing".
