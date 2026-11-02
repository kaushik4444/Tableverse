# Production readiness review

Last reviewed: 2026-11-02

This document separates protections implemented in the application from operational work that still requires deployment-owner decisions. A passing CI run is not, by itself, a production launch approval.

## Application controls present

- Production startup refuses to run without PostgreSQL, a working `pg` driver, a reachable database, and successful migrations.
- Database migrations run transactionally under a PostgreSQL advisory lock.
- Authentication uses HttpOnly session cookies, CSRF double-submit checks, password hashing, session revocation, and rate limits.
- WebSocket upgrades validate browser Origin when supplied; inbound payloads, per-IP connections, and per-socket message rates are bounded.
- Outbound WebSocket buffering, per-socket asynchronous message queues, and the global serial authentication queue are bounded. Slow consumers or overloaded handshakes are disconnected rather than allowed to accumulate unbounded memory.
- HTTP responses receive security headers, including a restrictive Content Security Policy, no-sniff, referrer and permissions policies; HSTS is enabled in production. Health/readiness probes are marked `no-store`.
- Finished match writes are retried and spooled locally before database persistence; shutdown drains the queue for a bounded period.
- HTTP header/body receive timeouts and keep-alive timeouts are bounded.
- Health (`/healthz`) and readiness (`/readyz`) endpoints are available.
- Render and Docker production builds use `npm ci` against the committed lockfile for reproducible dependency installation.
- CI runs game engines, HTTP/WebSocket flows, PostgreSQL integration, account lifecycle, access control and real-browser layout checks; it also audits production dependencies and builds the production Docker image.

## Deployment constraints to resolve before a public launch

### 1. Single-instance architecture

Live rooms, game state, WebSocket connections, and presence are held in process memory. Friends' online/presence status is explicitly instance-local. Running multiple web instances without a shared realtime state/broker would split rooms and presence between instances.

**Current safe operating model:** one application instance. Before horizontal scaling, move room state and pub/sub to a shared realtime layer (for example Redis) and design reconnect/routing for it. Do not simply increase the instance count.

### 2. Match-result spool durability

The match queue's default spool directory is under the operating system temporary directory. It protects against many process restarts on the same machine, but it is not durable across replacement of an ephemeral host. A failed database write can therefore still lose a match result if the instance is replaced before replay.

**Before relying on match history as a durable record:** configure a persistent disk for `MATCH_SPOOL_DIR`, or replace the local spool with a durable database-backed queue/outbox. Confirm the host's disk semantics and test a restart/redeploy recovery.

### 3. Hosting availability and capacity

The current Render Blueprint selects the free plan. Free instances can sleep and cold-start; this is suitable for friend testing, not a low-latency always-on multiplayer service. Set a paid always-on plan only after reviewing expected traffic and cost. Set explicit capacity limits and load-test the chosen instance/database size before launch.

### 4. Database operations

- Enable and verify automated backups/PITR appropriate to the chosen Neon plan.
- Perform a restore drill into a separate database; a backup that has never been restored is unverified.
- Monitor connection usage, query latency, storage, migration failures and rate-limit table growth.
- Keep application pool size aligned with the database's connection limit and the number of app instances.
- Run migrations in a controlled release window and retain a rollback/forward-fix plan. Migrations are currently applied during app startup.

### 5. Email and domain

Before opening registration broadly, verify the production sender domain with the email provider and publish SPF, DKIM and DMARC records. Test signup verification, resend, password reset, expired links, provider failures, and deliverability to major mailbox providers. Keep `REQUIRE_EMAIL_VERIFICATION=true` for public signup unless there is a deliberate, documented reason not to.

### 6. Monitoring and incident response

Configure external uptime checks for `/healthz` and `/readyz`, application error monitoring, structured log retention, and alerts for:
- repeated process restarts or failed deployments;
- database unavailability, pool exhaustion, and migration errors;
- WebSocket disconnect spikes and slow-consumer disconnects;
- failed/pending match writes and spool growth;
- email delivery failures and unusual auth/rate-limit activity.

Document who receives alerts and how to roll back a bad release.

### 7. Privacy, legal and user support

Before public launch, publish and review a privacy notice, terms/rules, contact/support route, and account/data deletion explanation. Confirm GDPR controller/processor roles, data retention, backup retention, email provider and hosting DPAs, and any analytics/cookie usage. Do not add tracking or advertising until consent/legal requirements are assessed.

### 8. Real-device and accessibility validation

Run the browser layout suite with Playwright installed and Chromium available. Test at least:
- 320–390 px portrait phones and narrow landscape;
- iOS Safari and Android Chrome;
- tablet portrait and desktop;
- keyboard-only navigation, visible focus, screen-reader announcements, zoom/text scaling, reduced motion;
- slow network, reconnect, tab background/foreground, and two-device account replacement.

Automated layout checks do not replace play-testing with real people on real devices.

## Release checklist

- [ ] Confirm the intended Render plan and one-instance deployment model.
- [ ] Configure persistent match spool or a durable database outbox.
- [ ] Verify Neon backups and complete a restore drill.
- [ ] Verify custom domain, HTTPS, sender-domain SPF/DKIM/DMARC and email flows.
- [ ] Configure uptime, error, database, match-queue and email alerts.
- [ ] Review privacy notice, terms, GDPR retention and processor agreements.
- [ ] Run full CI including required PostgreSQL integration tests.
- [ ] Run Playwright layout checks and manual iOS/Android/tablet/desktop sessions.
- [ ] Perform a production-like load test and reconnect/failure drill.
- [ ] Confirm rollback procedure and support contact.

## Scope of this code review

The code changes in this pass improve request/socket resource bounds, response security headers, cross-game status accessibility, mobile control sizing, and responsive-layout coverage. They do not silently change hosting plans, create infrastructure, alter production data, or claim that the operational checklist above has been completed.
