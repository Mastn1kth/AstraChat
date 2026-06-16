#!/usr/bin/env sh
set -eu

OUTPUT_DIR="${OUTPUT_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$OUTPUT_DIR/astrachat-postgres-$TIMESTAMP.sql.gz"

mkdir -p "$OUTPUT_DIR"
docker compose exec -T postgres pg_dump -U astrachat -d astrachat | gzip > "$TARGET"

find "$OUTPUT_DIR" -name 'astrachat-postgres-*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -delete

echo "Backup written: $TARGET"
