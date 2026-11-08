#!/usr/bin/env bash
# Runs the PostgreSQL test suites (npm run test:pg) against a throw-away local cluster, so they can be reproduced
# without a managed database. Needs the PostgreSQL server tools (initdb, pg_ctl, psql) on PATH and `npm ci` done.
#
#   scripts/pg-local-test.sh            # start the cluster, run test:pg, stop the cluster
#   scripts/pg-local-test.sh --keep     # leave the cluster running afterwards (prints the URL to use)
#   scripts/pg-local-test.sh --check    # start the cluster, check it accepts connections, stop it (no Node needed)
#
# The cluster listens on 127.0.0.1 only, trusts local connections (it is for tests, on this machine), and lives in
# ${PG_TEST_DIR:-$HOME/.cache/tableverse-pg-test}. Port: PG_TEST_PORT (default 55432). Nothing here touches a real database.
set -euo pipefail

PORT="${PG_TEST_PORT:-55432}"
DIR="${PG_TEST_DIR:-$HOME/.cache/tableverse-pg-test}"
# The directory goes into pg_ctl's option string, so only plain path characters are allowed.
case "$DIR" in
  *[!A-Za-z0-9_./-]*) echo "PG_TEST_DIR may contain only letters, digits and _ . / -  (write the full path; ~ is not expanded here)" >&2; exit 2 ;;
esac
KEEP=0
CHECK=0
case "${1:-}" in
  --keep) KEEP=1 ;;
  --check) CHECK=1 ;;
  "") ;;
  *) echo "usage: $0 [--keep|--check]" >&2; exit 2 ;;
esac

# Debian/Ubuntu install the server tools under /usr/lib/postgresql/<version>/bin, which is not on PATH: use the newest one.
if ! command -v initdb >/dev/null; then
  for d in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V -r); do PATH="$d:$PATH"; break; done
fi
for tool in initdb pg_ctl psql; do
  command -v "$tool" >/dev/null || { echo "$tool is not on PATH: install the PostgreSQL server tools (version 14 or newer)." >&2; exit 2; }
done

# Run server tools as the postgres user when this shell is root (initdb refuses to run as root).
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

mkdir -p "$DIR"
# A rerun may find files a root run left behind: fix the ownership of the cluster's own files only, never of a path given by the caller.
if [ "$(id -u)" = 0 ]; then
  case "$DIR" in /|"$HOME"|/home|/root|/tmp|/var|/usr) echo "PG_TEST_DIR must be a dedicated directory, not '$DIR'." >&2; exit 2 ;; esac
  mkdir -p "$DIR/data"; chown postgres "$DIR"; [ -e "$DIR/data" ] && chown -R postgres "$DIR/data"; [ -e "$DIR/server.log" ] && chown postgres "$DIR/server.log"
fi
if [ ! -f "$DIR/data/PG_VERSION" ]; then
  as_pg initdb -D "$DIR/data" -U postgres --auth=trust --encoding=UTF8 >/dev/null
fi
as_pg pg_ctl -D "$DIR/data" -l "$DIR/server.log" -w -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" start >/dev/null

stop() { as_pg pg_ctl -D "$DIR/data" -m fast stop >/dev/null 2>&1 || true; }
URL="postgres://postgres@127.0.0.1:$PORT/postgres"

if [ "$CHECK" = 1 ]; then
  psql "$URL" -Atc "SELECT 'cluster ok: ' || version()" | cut -c1-60
  stop
  exit 0
fi

if [ "$KEEP" = 1 ]; then
  echo "PostgreSQL is running. Use: TEST_DATABASE_URL='$URL' npm run test:pg"
  exit 0
fi

trap stop EXIT
cd "$(dirname "$0")/.."
TEST_DATABASE_URL="$URL" npm run -s test:pg
