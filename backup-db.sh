#!/usr/bin/env bash
# backup-db.sh — one-shot Postgres backup for the spend tracker.
# Run on the server, in the app folder:  ./backup-db.sh
# Writes a timestamped .sql file into ./backups/ (gitignored).
set -euo pipefail

cd "$(dirname "$0")"

# Use DATABASE_URL from the environment, or read it from .env
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
    DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
fi
if [ -z "${DATABASE_URL:-}" ]; then
    echo "No DATABASE_URL found in the environment or .env" >&2
    exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
    echo "pg_dump not installed. On Ubuntu/Debian: sudo apt install postgresql-client" >&2
    exit 1
fi

mkdir -p backups
FILE="backups/spendtracker-$(date +%Y%m%d-%H%M%S).sql"
pg_dump "$DATABASE_URL" > "$FILE"
echo "Backup written to $FILE ($(du -h "$FILE" | cut -f1))"
