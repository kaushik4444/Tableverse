'use strict';
/**
 * Replays every finished match into skill ratings (design/scoring-skill-ratings.md, steps 2 and 3). The logic is in db/ratings.js.
 *
 *   node scripts/ratings-replay.js                  dry run: reads the matches, prints the report, writes nothing
 *   node scripts/ratings-replay.js --apply          rebuilds the ratings and the ledger in one transaction
 *
 * --apply also needs RATINGS_REPLAY_CONFIRM=replay-all-matches, so it cannot run by accident. It runs against whatever
 * DATABASE_URL points at: point it at a COPY of the database first, review the report, then run it on production.
 * Take a backup before --apply on production (see the design doc).
 */
const db = require('../db/pool');
const { computeRatings, rebuildRatings } = require('../db/ratings');

const APPLY = process.argv.includes('--apply');

function printReport(rep, ratingCount) {
  for (const g of Object.keys(rep).sort()) {
    const r = rep[g];
    console.log(`${g.padEnd(16)} matches ${String(r.matches).padStart(6)}  rated ${String(r.rated).padStart(6)}  unrated ${String(r.unrated).padStart(6)}`);
    for (const [reason, n] of Object.entries(r.reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`${' '.repeat(18)}- ${reason}: ${n}`);
    }
  }
  console.log(`ratings that would be written: ${ratingCount}`);
}

async function main() {
  if (!db.hasDatabase()) throw new Error('DATABASE_URL is not set.');
  if (!APPLY) {
    const c = await computeRatings();
    console.log(`matches read: ${c.matchesRead}; forfeits recorded since: ${c.forfeitsRecordedSince ? new Date(c.forfeitsRecordedSince).toISOString() : 'unknown (all leaves unrated)'}`);
    printReport(c.report, c.ratings.length);
    console.log('dry run: nothing was written. Re-run with --apply and RATINGS_REPLAY_CONFIRM=replay-all-matches to write.');
    return;
  }
  if (process.env.RATINGS_REPLAY_CONFIRM !== 'replay-all-matches') {
    throw new Error('Refusing to apply: set RATINGS_REPLAY_CONFIRM=replay-all-matches after reviewing the dry run.');
  }
  const done = await rebuildRatings();
  console.log(`applied: ${done.matches} matches, ${done.ratings} ratings, ${done.events} ledger rows.`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(`[ratings-replay] ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
