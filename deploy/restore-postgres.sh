#!/usr/bin/env sh
set -eu

# Restores a PostgreSQL backup produced by backup-postgres.sh (or the
# server's pg_dump-based admin backup) into the running `postgres` compose
# service. This is DESTRUCTIVE: it drops and recreates the target database
# before loading the dump, so it always asks for confirmation unless
# CONFIRM=yes is set in the environment (e.g. for scripted/CI use).
#
# Usage:
#   ./deploy/restore-postgres.sh backups/astrachat-postgres-20260702-101500.sql.gz
#   CONFIRM=yes ./deploy/restore-postgres.sh backups/onda-.../database.sql.gz

BACKUP_FILE="${1:-}"
PG_USER="${PG_USER:-astrachat}"
PG_DB="${PG_DB:-astrachat}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <path-to-backup.sql.gz|path-to-backup.sql>" >&2
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

echo "This will DROP and recreate database '$PG_DB' on the 'postgres' compose service,"
echo "then load: $BACKUP_FILE"
echo "All current data in '$PG_DB' will be permanently lost."

if [ "${CONFIRM:-}" != "yes" ]; then
  printf 'Type the database name (%s) to confirm: ' "$PG_DB"
  read -r ANSWER
  if [ "$ANSWER" != "$PG_DB" ]; then
    echo "Confirmation did not match. Aborting, nothing was changed." >&2
    exit 1
  fi
fi

echo "Terminating existing connections to '$PG_DB'…"
docker compose exec -T postgres psql -U "$PG_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PG_DB' AND pid <> pg_backend_pid();"

echo "Dropping and recreating '$PG_DB'…"
docker compose exec -T postgres psql -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$PG_DB\";"
docker compose exec -T postgres psql -U "$PG_USER" -d postgres -c "CREATE DATABASE \"$PG_DB\" OWNER \"$PG_USER\";"

echo "Restoring from $BACKUP_FILE…"
case "$BACKUP_FILE" in
  *.gz)
    gunzip -c "$BACKUP_FILE" | docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB"
    ;;
  *)
    docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" < "$BACKUP_FILE"
    ;;
esac

echo "Restore complete. Restart the app service so it reconnects cleanly:"
echo "  docker compose restart app"
