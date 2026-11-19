'use strict';
/**
 * Temporary names for guests. A guest types a name (or gets "Guest"). If that name is already in use by someone who has been
 * around in the last week, a random four-digit number is added to the end, and the check is repeated a few times.
 * Pure apart from the `isTaken` callback, so it can be tested without a database.
 */
const crypto = require('crypto');

const DEFAULT_NAME = 'Guest';
const MAX_LEN = 20;
const SUFFIX_TRIES = 6;

/** Keeps letters, numbers, spaces, underscores and hyphens; collapses spaces; trims; caps the length. */
function cleanGuestName(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LEN)
    .trim();
  return s || DEFAULT_NAME;
}

/** A random four-digit number as a string, 1000-9999. */
function fourDigits() {
  return String(1000 + crypto.randomInt(9000));
}

/**
 * The name a new guest gets. `isTaken(name)` resolves true when someone else already uses it (case-insensitively).
 * If the base name is free it is used as it is; otherwise "Name1234" is tried until one is free.
 */
async function pickGuestName(raw, isTaken = async () => false) {
  const base = cleanGuestName(raw);
  if (!(await isTaken(base))) return base;
  for (let i = 0; i < SUFFIX_TRIES; i++) {
    const suffix = fourDigits();
    const trimmed = base.slice(0, MAX_LEN - suffix.length);
    const candidate = `${trimmed}${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // a long run of collisions is unlikely; a longer random tail still keeps the name readable
  return `${base.slice(0, MAX_LEN - 6)}${fourDigits()}${fourDigits().slice(0, 2)}`;
}

module.exports = { cleanGuestName, pickGuestName, DEFAULT_NAME, MAX_LEN };
