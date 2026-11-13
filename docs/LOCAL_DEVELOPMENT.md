# Local development

How to run Tableverse on your own computer (Windows 10 or 11 is the main path below), create a test account, run the migrations and
open the admin console, without touching the production database or any paid service.

Local commands use a database on your own computer only. They refuse managed hosts (Neon, Render, Supabase, AWS and similar) and
any other non-local host, and they refuse `NODE_ENV=production`. Never copy the production `DATABASE_URL` into `.env.local`.

## What works without a database, and what does not

| Feature | Without `DATABASE_URL` | With local PostgreSQL |
|---|---|---|
| Guest play, tables, chat, games | yes (in memory, lost on restart) | yes |
| Register, log in, e-mail verification, password reset, sessions and devices | no: answers 503 "Email authentication requires PostgreSQL" | yes |
| Friends, friend requests, table invitations | no | yes |
| Own profile, country, history, recent tables, account deletion | no | yes |
| Match records, player statistics, insights | no | yes |
| Admin console, moderation reports, announcements, feedback | no | yes |

Guest play is in-memory only. Everything that stores an account, a session or a result needs PostgreSQL. The functions involved are in
`db/auth.js`, `db/account.js`, `db/friends.js`, `db/matches.js`, `db/admin.js` and `db/moderation.js`.

Without a mail service nothing is sent: when no provider is configured the verification e-mail is skipped, and `REQUIRE_EMAIL_VERIFICATION=false`
(set in `.env.local.example`) lets a new account log in at once. No Resend key is needed locally.

## Prerequisites

| Need | Version and notes |
|---|---|
| Node.js | **22** (what the Dockerfile and Render run). CI tests Node 20 and 22. `package.json` declares `>=18`, but do not use anything older than 20. |
| npm | Comes with Node.js. |
| Docker Desktop | Recommended for the local database (the commands below). Start it and wait until it says "running". |
| PostgreSQL | Alternative to Docker: PostgreSQL 14 or newer on this computer, with an empty database. |
| Git | To clone the repository. |

## One-time setup

### macOS, Linux, or Windows with Git Bash or WSL

```bash
git clone https://github.com/kaushik4444/Tableverse.git
cd Tableverse
npm ci
cp .env.local.example .env.local
docker run -d --name tableverse-pg -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=tableverse_dev \
  -p 127.0.0.1:55433:5432 postgres:16
npm run dev:migrate
npm run dev:seed -- --email me@local.test --username localme --owner
npm run dev
```

### Windows 10 or 11 (PowerShell)

Run these in PowerShell from the folder you cloned into.

```powershell
git clone https://github.com/kaushik4444/Tableverse.git
cd Tableverse
npm ci
copy .env.local.example .env.local
docker run -d --name tableverse-pg -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=tableverse_dev -p 127.0.0.1:55433:5432 postgres:16
npm run dev:migrate
npm run dev:seed -- --email me@local.test --username localme --owner
npm run dev
```

- Keep the `docker run` command on one line; PowerShell does not use `\` for line continuation.
- Docker Desktop must be running before `docker run`. If you see "error during connect", start Docker Desktop and retry.
- The `docker run` command only needs to succeed once. Later, start the container with `docker start tableverse-pg`.
- If PowerShell says that running scripts is disabled, use `npm.cmd` in place of `npm`, or run once:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Open <http://localhost:3000>. The `npm run dev` window stays open while the app runs; press Ctrl+C in it to stop.

### Already have PostgreSQL

Create an empty database, then set `DATABASE_URL` in `.env.local` to its URL (for example
`postgres://postgres:yourlocalpassword@127.0.0.1:5432/tableverse_dev`). Keep the host `127.0.0.1` or `localhost`. Then run the same
commands from `npm run dev:migrate` onward.

## Steps in order

1. **Install:** `npm ci` (installs exactly the versions in `package-lock.json`, including the native `@node-rs/argon2` package).
2. **Configure:** `.env.local` is a copy of `.env.local.example`. It holds the local database URL and `REQUIRE_EMAIL_VERIFICATION=false`.
   It is git-ignored; never commit it.
3. **Start the database:** the Docker container above, or your own local PostgreSQL.
4. **Migrate:** `npm run dev:migrate` applies the migrations in `db/migrations` to the local database. Run it again after every
   `git pull`; it reports "Database is up to date" when there is nothing new.
5. **Create test accounts:** see the next section.
6. **Start the app:** `npm run dev`.
7. **Test:** see *Tests* below.

## Create a test account (and a local admin)

```bash
npm run dev:seed -- --email me@local.test --username localme --owner
```

It runs the migrations, creates a verified account and prints a **generated password once**:

```
Created local test account
  e-mail:    me@local.test
  username:  localme
  role:      owner
  password:  Kf7!qWm2#zPb9-Xr4Tc_   (shown once; it is not stored anywhere readable)
```

- `--owner` makes the account the owner of this local database, which unlocks the admin console. Leave it out for an ordinary account.
  A local database can have only one owner.
- Run the command again with the same e-mail to keep the account. Add `--reset-password` to get a new password if you lost it.
- Use an e-mail ending in `.test` or `.local`. It never leaves your computer.
- There are no built-in credentials: every password is generated, and the repository contains none.
- Create a second, ordinary account by using a different `--email` and `--username` without `--owner`.

## Run the app

```bash
npm run dev
```

Open <http://localhost:3000>, choose **Log in**, and use the e-mail and password from the seed command.

`npm run dev` loads `.env.local`, checks the database, makes e-mail verification optional and starts the server with only that checked
environment. The server never reads a file itself. `npm start` does not read `.env.local`, so use `npm run dev` for local work.

## Open the admin console locally

1. Create the account with `--owner` (above) and log in at <http://localhost:3000>.
2. Open <http://localhost:3000/admin.html>, or use the Admin link in the account menu.

The owner role is read from the local database on every admin request. There is no admin switch in the browser. In production the owner
is set on the server through `ADMIN_OWNER_EMAIL` / `ADMIN_OWNER_ID` (see `docs/ADMIN.md`).

## Reset local test data

Resetting touches only the local database named in `.env.local`. The dev tools refuse anything else.

Wipe the database but keep the container:

```bash
docker exec tableverse-pg psql -U postgres -c "DROP DATABASE IF EXISTS tableverse_dev" -c "CREATE DATABASE tableverse_dev"
npm run dev:migrate
npm run dev:seed -- --email me@local.test --username localme --owner
```

Remove everything, including the container:

```bash
docker rm -f tableverse-pg
```

Then repeat the Docker `run` command and the steps after it. (PowerShell: the same commands work; the `docker exec` line is one line.)

## Safety rules (enforced in code and covered by tests)

- `npm run dev`, `npm run dev:seed` and `npm run dev:migrate` **refuse `NODE_ENV=production`**.
- They **refuse managed hosts** outright. Any other remote host needs an explicit `ALLOW_REMOTE_DEV_DB=1`. The check runs before anything
  connects (`lib/devEnv.js`, `tests/dev-env.test.js`).
- `db/pool.js` reads only `.env`, never `.env.local`. So `npm run migrate` and the other ops scripts do not pick up a local `.env.local`
  (use `npm run dev:migrate` for local work). `tests/db-pool-env.test.js` checks this.
- Passwords are generated with a cryptographic random source and meet the same password rule as real sign-ups.
- The seed code is never loaded by the server, so the running app cannot reach it.
- `.env.local` is git-ignored. Only `.env.local.example` (no secrets) is committed.
- The automated tests use their own throw-away databases (`TEST_DATABASE_URL`) and never `DATABASE_URL`. The test helper refuses managed hosts too.

## Tests

| Command | What it runs | What it needs |
|---|---|---|
| `npm test` | The unit and integration suites that do not need PostgreSQL (includes `tests/smoke.test.js`). | `npm ci` |
| `npm run test:pg` | The PostgreSQL suites listed in the `test:pg` script in `package.json`. | A test database URL (below) |
| `npm run test:ui` | Browser layout and interaction tests with Playwright (admin, invitations, redraw, Go Fish). | Playwright and a Chromium browser (below) |
| `npm run test:audit` | Browser audit of the game screens. | Playwright (below) |

**Important:** when a test needs something that is missing, it prints `SKIPPED` and the command still exits with code 0. Read the
output: `npm test` shows `SKIPPED` for the PostgreSQL suites unless `TEST_DATABASE_URL` is set, and `test:ui` shows `SKIPPED` unless
Playwright is installed. A green run with SKIPPED lines has not run those tests. `npm run test:pg` is the one that fails when the database is missing.

PostgreSQL suites (use a database that the tests may create and drop; this is not your development database):

```bash
TEST_DATABASE_URL=postgres://postgres:devpassword@127.0.0.1:55433/postgres npm run test:pg
```

Windows PowerShell:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:devpassword@127.0.0.1:55433/postgres"; npm run test:pg
```

Browser tests (Playwright is not a project dependency, so install it for local runs; CI installs it the same way):

```bash
npm install --no-save playwright
npx playwright install chromium
npm run test:ui
```

Windows PowerShell: the same three commands work.

## Troubleshooting (including Windows)

| You see | Cause and fix |
|---|---|
| "Email authentication requires PostgreSQL" (503) | There is no `DATABASE_URL`. Start the database, fill `.env.local`, then use `npm run dev`. |
| `Refusing to use ... managed ... database` | `.env.local` or your shell points at Neon or Render. Set the local URL. |
| `connect ECONNREFUSED 127.0.0.1:55433` | The database container is not running: `docker start tableverse-pg`. |
| `error during connect` / "Docker daemon" | Docker Desktop is not running. Start it and wait until it says "running". |
| `docker: Error response from daemon: Conflict. The container name "/tableverse-pg" is already in use` | The container exists. Use `docker start tableverse-pg`, or `docker rm -f tableverse-pg` and run it again. |
| `EADDRINUSE` on port 3000 | Another program uses the port. Find it with `netstat -ano \| findstr :3000` (PowerShell: `netstat -ano | findstr :3000`), or set `PORT=3100` in `.env.local`. |
| Port 55433 already in use | Use another host port in the `docker run` command and the same port in `.env.local` and `TEST_DATABASE_URL`. |
| `running scripts is disabled on this system` (PowerShell) | Use `npm.cmd`, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. |
| `npm ci` fails while installing `@node-rs/argon2` | Use Node.js 22 from nodejs.org and a working internet connection. Delete `node_modules` and run `npm ci` again. |
| "Invalid email or password" right after seeding | The password was shown once. Run the seed command again with `--reset-password`. |
| "Please verify your email" | `REQUIRE_EMAIL_VERIFICATION` is `true` in your shell or `.env.local`. Set it to `false`. Seeded accounts are already verified. |
| Admin console says "forbidden" | The account is not the owner. Seed with `--owner` (works only while the local database has no owner). |
| WebSocket connection fails in the browser | Open the app at `http://localhost:3000`, not a file path. Check that `npm run dev` is still running and no firewall blocks port 3000. |
| `Cannot find module 'ws'` or `'pg'` | Run `npm ci` in the project folder. |

## What has been verified for this guide

Verified by the automated checks in this repository (run in CI and locally):

- The safety checks in `lib/devEnv.js` and the loader rule in `db/pool.js` (`tests/dev-env.test.js`, `tests/db-pool-env.test.js`).
- The commands and file names in this guide exist in `package.json`, `scripts/` and `.env.local.example`.

**Not verified** in this preparation environment (no Docker daemon, no Windows machine, and no network for a clean `npm ci`):

- A fresh clone followed step by step.
- The Docker `run` command, `npm run dev:migrate` and `npm run dev:seed` against a live PostgreSQL.
- Every command on Windows 10 or 11 in PowerShell.
- The browser tests with Playwright installed.

Run the steps once on a clean checkout and record the result before relying on this guide.
