'use strict';
/**
 * Require this FIRST in every test that can touch the database or the server.
 *
 * It makes the test process unable to reach a real database by accident:
 *  - NODE_ENV=test, and db/pool.js then never reads .env / .env.local (a developer's file may hold the production URL)
 *  - DATABASE_URL is removed from this process. Memory-mode tests therefore always run on the in-memory store.
 *  - the original value is remembered so tests/helpers/testdb.js can refuse a test database on the same host.
 * PostgreSQL tests opt in explicitly through TEST_DATABASE_URL (see testdb.js), never through DATABASE_URL.
 */
if (process.env.DATABASE_URL && !process.env.TV_ORIGINAL_DATABASE_URL) process.env.TV_ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
// Debug tokens (raw verification and reset tokens in API responses) are an explicit test-only opt-in; see lib/debugTokens.js.
process.env.TABLEVERSE_ALLOW_DEBUG_TOKENS = '1';
process.env.TABLEVERSE_SKIP_DOTENV = '1';
delete process.env.DATABASE_URL;
// Metered TURN credentials cost quota and must never be requested by a test: tests inject a stub when they need one.
delete process.env.METERED_APP_NAME;
delete process.env.METERED_SECRET_KEY;
