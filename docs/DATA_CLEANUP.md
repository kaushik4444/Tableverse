# Stage 7: removing all user and gameplay data

Purpose: empty every table that holds users or their history, **keep the schema, the indexes, the constraints and the
migration history**, and leave the application working. This document is the plan and the runbook. The script is
`scripts/cleanup-user-data.js` (library: `db/cleanup.js`).

**Nothing in this repository runs the cleanup by itself.** It only happens when a person runs the command in section 4
with `--execute` and the confirmation. The script was developed and tested only on throw-away local databases.

## 1. Every table in the database (from `db/migrations/001` to `015`)

There are 22 tables and 21 foreign keys: 21 tables are emptied and `schema_migrations` is preserved. The list below is the
plan in `db/cleanup.js` (`PLAN`, `PRESERVE`, `EXPECTED_FKS`). The script re-discovers the live schema on every run and
**refuses** if it finds a table or foreign key that is not in this list, a trigger, or a migration set that differs from
this code version.

| Order | Table | What it stores | Action | Foreign keys |
|---|---|---|---|---|
| 1 | `announcement_dismissals` | Which signed-in account dismissed which announcement banner (migration 013) | **Empty** | `announcements`, `players` (CASCADE) |
| 2 | `admin_audit_log` | Admin console audit log: who (account id) did what to which target (migration 013) | **Empty** | `players` (SET NULL) |
| 3 | `feedback` | Feedback sent by players: optional account id, category, message, status (migration 013) | **Empty** | `players` (SET NULL) |
| 4 | `announcements` | Announcement banners (text, level, audience, schedule) and the admin who created them (migration 013) | **Empty** | `players` (SET NULL) |
| 5 | `analytics_active` | Distinct active accounts per day as keyed hashes, no account ids (migration 013) | **Empty** | none |
| 6 | `analytics_batches` | Keys of applied analytics writes: random ids, no account or personal data (migration 013) | **Empty** | none |
| 7 | `analytics_meta` | Server-side analytics settings: the hashing salt, created on demand (migration 013) | **Empty** | none |
| 8 | `analytics_daily` | Aggregate daily counters per metric and dimension, no personal data (migration 013) | **Empty** | none |
| 9 | `match_participants` | Per-player result rows of finished games (name, seat, score, winner / bot / left-early flags, optional account id) | **Empty** | `matches` (CASCADE), `players` (SET NULL) |
| 10 | `private_table_invitations` | Private-table invitations and their lifecycle metadata | **Empty** | `players` (CASCADE, 2 keys) |
| 11 | `chat_reports` | Chat reports (migrations 010 and 015): reporter, optional reported account, reported-name snapshot, table code, message id, a copy of the reported text, reason, details | **Empty** | `players` (reporter CASCADE; reported account SET NULL) |
| 12 | `player_blocks` | Chat blocks (migration 010): which account hid which other account's table chat | **Empty** | `players` (CASCADE, 2 keys) |
| 13 | `friend_requests` | Friend request participants and lifecycle status | **Empty** | `players` (CASCADE, 2 keys) |
| 14 | `friendships` | Accepted player relationships | **Empty** | `players` (CASCADE, 2 keys) |
| 15 | `matches` | Finished games (game, room code, seats, options, time, idempotency `match_key`) | **Empty** | referenced by `match_participants` (deleted before it) |
| 16 | `auth_email_tokens` | Hashed single-use verification / password-reset tokens and the address they were sent to | **Empty** | `players` (CASCADE) |
| 17 | `auth_sessions` | Hashed session tokens: registered **and legacy anonymous**, with expiry / revocation | **Empty** | `players` (CASCADE) |
| 18 | `auth_identities` | Login methods: email, Argon2 password hash, verification time | **Empty** | `players` (CASCADE) |
| 19 | `player_recent_tables` | Recently visited table codes per account (migration 005) | **Empty** | `players` (CASCADE) |
| 20 | `auth_rate_limits` | Hashed per-address / per-email rate-limit counters | **Empty** | none |
| 21 | `players` | Accounts: registered players and **legacy anonymous players** | **Empty** (last) | referenced by the tables above |
| – | `schema_migrations` | Which migration files were applied | **PRESERVE, never touched** | none, not in the plan |

**Migration 013 (admin console, Stage 20.5) adds eight tables**, all of them emptied in the plan above:
`analytics_daily`, `analytics_active`, `analytics_batches`, `analytics_meta`, `feedback`, `announcements`,
`announcement_dismissals` and `admin_audit_log`. It also adds the column `players.role`, which needs no separate step.
Migration 014 adds two columns and no tables; migration 015 adds the reported-name snapshot and changes the moderation report foreign-key action: `announcements.revision` and `announcement_dismissals.dismissed_revision` (see [ADMIN.md](ADMIN.md)). Details and retention periods are in [ADMIN.md](ADMIN.md). The plan lives in `db/cleanup.js`; `tests/cleanup.test.js` fails
until every table in the migrations is classified there, and this section must be updated with it.

Player statistics are not stored anywhere: they are computed from `matches` / `match_participants`, so emptying those
removes all stats. There are no other user-related tables, views, sequences (all keys are UUIDs) or triggers.

Why this order: every table is deleted **before** the tables it references, so no row is ever left pointing at a
deleted parent and nothing depends on `ON DELETE CASCADE` / `SET NULL` doing deletions behind the script's back. The
script checks that each `DELETE` removed exactly the rows it counted and that the tables still to come are unchanged.
It never uses `TRUNCATE`, `DROP`, `ALTER`, `CREATE` or `CASCADE`.

## 2. What the script guarantees

* **Dry run by default**: read-only transaction (`BEGIN READ ONLY`), always rolled back. Prints the row count of every table, breakdowns and a masked sample of the records.
* **Two things are needed to delete**: `--execute` and `--confirm=<exact database name>`.
* **The target is named on purpose**: `CLEANUP_DATABASE_URL` only. `DATABASE_URL` and `.env` files are ignored. A remote host must also be repeated with `--expect-host=<host>`. The connected `current_database()` must equal the URL's database. A running migration (advisory lock) blocks it.
* **Expected state only**: same 22 tables (21 emptied and `schema_migrations`), same 21 foreign keys, no triggers, no other schema, and exactly the migrations in `db/migrations` applied. Anything else is refused with the list of differences.
* **One transaction**: tables are locked (`SHARE ROW EXCLUSIVE`: readers keep working, writers wait), counted, deleted in the order above and checked; a schema and migration-history fingerprint taken before and after must be identical. Any error, mismatch or timeout rolls everything back (`lock_timeout` 10 s, `statement_timeout` 5 min).
* **Nothing sensitive is printed**: emails are masked (`a***@example.com`), token hashes are never selected, chat-report message text and user-supplied details are excluded from samples, the connection password is never shown, and the snapshot file holds only structure digests and counts.

## 3. Before you run it for real (checklist)

1. Review this document, `db/cleanup.js` and the tests (`npm run test:pg`).
2. Take a database backup / branch of the Neon database (Neon: create a branch or enable point-in-time restore) so the deletion can be undone.
3. Put the site in maintenance (suspend the Render service, or scale it to zero) so nobody registers during the deletion. The script blocks writers while it runs, but players would see errors.
4. Make sure the database is migrated to the version of this repository (`npm run migrate`, or simply deploy it). The script refuses otherwise.

## 4. Commands

Use the **direct** (non-pooled) Neon connection string if you have one. Quote the URL. Never put it in a file in the repository.

```bash
# 1. Dry run (default, read-only). Writes a schema snapshot (no user data) for the later comparison.
CLEANUP_DATABASE_URL='postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require' \
  node scripts/cleanup-user-data.js --expect-host=HOST --snapshot=pre-cleanup.json

# 2. The cleanup. Only after the dry run output was reviewed and approved.
CLEANUP_DATABASE_URL='postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require' \
  node scripts/cleanup-user-data.js --execute --confirm=DBNAME --expect-host=HOST --snapshot=pre-cleanup.json

# 3. Verify afterwards (read-only)
CLEANUP_DATABASE_URL='postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require' \
  node scripts/cleanup-user-data.js --verify --expect-host=HOST --snapshot=pre-cleanup.json
```

`npm run cleanup:users -- <options>` is the same command. Options: `--sample=<n>` (rows shown per table, default 5),
`--json`, `--expect-db=<name>`, `--no-app-smoke` (verify only), `--help`.
Exit codes: `0` done, `1` failed (rolled back), `2` refused (nothing changed).

## 5. Verification after the execution

`--verify` (read-only) checks that:

* every one of the 21 emptied tables is empty, and no legacy anonymous player remains;
* `schema_migrations` lists exactly the repository's migrations and is byte-identical to the snapshot (versions and `applied_at`);
* the schema fingerprint (tables, columns, indexes, constraints, triggers) equals the snapshot, and all 21 foreign keys exist;
* the application's own read paths work on the database (player stats query, username lookup, session lookup).

Then do the manual end-to-end check: open the site, register a test account, verify the email, log in, join a table.
(The tests do exactly this automatically on a cleaned throw-away database.) Resume the Render service afterwards.

## 6. Tests

* `tests/cleanup.test.js` (no database): the plan covers exactly the tables the migrations create (22, including `analytics_batches`); order versus foreign keys; refusals (unknown table, trigger, extra / missing foreign key or migration, remote host, missing or wrong confirmation, `DATABASE_URL` fallback); the source contains no `TRUNCATE` / `DROP` / `ALTER` / `CASCADE`.
* `tests/cleanup.pg.test.js` (real PostgreSQL, throw-away database, needs `TEST_DATABASE_URL`): a dry run issues only read statements and leaves every table byte-identical; `--execute` without or with a wrong confirmation deletes nothing; wrong deletion orders are refused; errors after any delete, before commit and a lock timeout all roll back completely; the real execution empties the 21 tables in plan order (the seeded row counts are derived from the plan), keeps `schema_migrations` byte-identical and the schema fingerprint and foreign keys unchanged; `--verify` passes afterwards and fails on a database that still has data; an end-to-end CLI run (dry run, execute, verify); and the application then registers, verifies, logs in and reaches the lobby, and migrations report nothing pending.

```bash
npm test                                   # unit tests; the PostgreSQL files print SKIPPED without TEST_DATABASE_URL
TEST_DATABASE_URL=postgres://postgres:secret@127.0.0.1:5432/postgres npm run test:pg
```

## 7. Limits

* Rolling back is only possible until `COMMIT`. After that the backup from the checklist is the only way back.
* In-memory state of a running server (tables, rooms, cached players) is not in the database. Restart the Render service after the cleanup so it starts empty; browsers holding old cookies simply land on the login page.
* A future migration that adds a table makes `tests/cleanup.test.js` fail until the table is classified in `db/cleanup.js` (emptied or preserved) and the docs are updated. That is intended.

## Unverified accounts (30 days)

Accounts that registered, never verified their e-mail, are more than 30 days old, are not guests, and are not admins or
owners can be removed. The rule is in `db/unverifiedCleanup.js` (`CANDIDATE`). Each batch re-checks the rule inside its own
transaction, so an account verified a moment earlier is kept.

Commands (the script reads `DATABASE_URL`; the workflow sets it from a secret):

```
node scripts/cleanup-unverified.js                  # dry run: prints the count, deletes nothing
node scripts/cleanup-unverified.js --execute        # deletes, in batches of 200; refuses above --max (default 1000, exit 3)
node scripts/cleanup-unverified.js --days 45        # another period, 1-365 days
```

A dry run runs its count in a `READ ONLY` transaction and refuses (exit 2, nothing run) any database role that is a
superuser or that has INSERT, UPDATE, DELETE or TRUNCATE on a table in `public`. So a dry run cannot change data even if
the wrong URL is used.

### What is deleted with an account

- The account's logins, tokens, sessions, recent tables, dismissals, friendships, friend requests, private-table
  invitations and chat blocks are removed, in both directions where a relationship has two sides.
- Reports made by a deleted reporter are removed (`reporter_id` cascades). Reports **against** a deleted account remain:
  migration 015 clears `reported_id` with `ON DELETE SET NULL` and preserves the server-captured
  `reported_display_name`, message, reason, details, room and timestamp. This retains moderation evidence without
  retaining the deleted account UUID.
- Match history is kept; `match_participants.player_id` is cleared and the name becomes the deleted-player name.
- `tests/unverified-cleanup.pg.test.js` checks every foreign key to `players`: each must cascade or set NULL. A new
  reference that does neither fails the test until it is classified here.

### The workflow (.github/workflows/cleanup-unverified.yml)

Two jobs, two database roles:

| Job | When | Database secret | Environment |
|---|---|---|---|
| `cleanup-dry-run` | every day at 03:17 UTC, and by hand | `CLEANUP_DRYRUN_DATABASE_URL` (SELECT only) | none |
| `cleanup-delete` | only by hand, with `execute` ticked **and** the variable `CLEANUP_EXECUTE` = `true`; runs after the dry run | `CLEANUP_DATABASE_URL` (can delete) | `production-cleanup` (required reviewer) |

- The dry run never reads the deletion secret, and the schedule never reaches the deletion job.
- The `production-cleanup` environment's required reviewer approves the deletion job whatever the inputs say. The input
  only requests it; it cannot skip the approval.
- `CLEANUP_EXECUTE` is a second switch. Keep it `false` until a deletion has been approved on purpose.
- Both job summaries say how many accounts were counted. The dry run states "Records deleted by this run: 0."

### Setup the owner does (not done by this repository)

**1. Create the read-only Neon role** (Neon console, project, branch of production). Run this SQL in the SQL
editor as the database owner; it creates the role and grants read-only access. Replace the placeholders; generate the
password yourself and store it only in GitHub:

```sql
CREATE ROLE cleanup_readonly LOGIN PASSWORD '<generated password>';
GRANT CONNECT ON DATABASE <database name> TO cleanup_readonly;
GRANT USAGE ON SCHEMA public TO cleanup_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cleanup_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cleanup_readonly;
```

`ALTER DEFAULT PRIVILEGES` covers tables later created by the role that runs it (the owner, which runs the migrations).
Check that the new role cannot delete (in a session as that role, `DELETE FROM players WHERE false;` must fail with
"permission denied"). Build its connection string from the same host and database, with the new user and password.

**2. Add the GitHub secret for the dry run.** Repository Settings, Secrets and variables, Actions, New repository secret:
name `CLEANUP_DRYRUN_DATABASE_URL`, value the read-only connection string. Do not paste it anywhere else.

**3. Create and protect the deletion environment before any execute run.** Settings, Environments, create
`production-cleanup` (do not rely on the workflow creating it automatically). GitHub creates a missing environment
referenced by a workflow without protection rules, so the name alone is not an approval gate. Configure:
- Required reviewers: add the person who must approve each deletion; tick "Prevent self-review" if another person should approve;
- Deployment branches and tags: "Selected branches", only `main`;
- add the secret `CLEANUP_DATABASE_URL` to this environment. After confirming it is present there, remove the
  repository-level secret with the same name so the deletion credential is scoped to the protected job. The dry-run job
  never reads either deletion-secret location.
- Before any manual execute request, verify the environment page visibly lists the required reviewer and the branch rule.
  A manual input cannot bypass a configured environment gate, but workflow YAML cannot create the reviewer rule itself.

**4. Keep the kill switch.** Repository variable `CLEANUP_EXECUTE` stays `false` until you approve a deletion.

**5. Check the first scheduled run** in the Actions tab: the dry run should show a count and "Records deleted by this
run: 0." Nothing is deleted until you start the workflow by hand with `execute` ticked, the variable set to `true`, and
you approve the `production-cleanup` deployment.

- `--execute` refuses to delete more than 1000 accounts in a run (exit 3, nothing deleted). Review the dry run before raising `--max`.
- Tests: `tests/unverified-cleanup.pg.test.js` (PostgreSQL, part of `npm run test:pg`), `tests/cleanup-workflow.test.js`
  (the workflow's structure, in `npm test`).
