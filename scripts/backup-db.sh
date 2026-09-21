#!/usr/bin/env bash
# Compressed dump of the Postgres database (accounts, sessions, libraries, profiles, usage) — the one thing on this VM
# that cannot be rebuilt from the repo. Keeps the newest 14 dumps. Run from anywhere:
#   ./scripts/backup-db.sh                      # writes to ./backups
#   BACKUP_DIR=/var/backups/suwwara ./scripts/backup-db.sh
# Nightly at 03:15 (crontab -e):
#   15 3 * * * cd /path/to/suwwara && ./scripts/backup-db.sh >> backups/backup.log 2>&1
# Restore (into a running stack; replaces current data):
#   gunzip -c backups/suwwara-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U suwwara -d suwwara
# Copy backups OFF this machine too (another disk, a bucket): a backup on the VM dies with the VM.
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP="${KEEP:-14}"
mkdir -p "$BACKUP_DIR"

target="$BACKUP_DIR/suwwara-$(date +%F-%H%M).sql.gz"
docker compose exec -T postgres pg_dump -U suwwara --clean --if-exists suwwara | gzip > "$target.partial"
gzip -t "$target.partial"           # refuse to keep a truncated dump
mv "$target.partial" "$target"
echo "$(date '+%F %T') wrote $target ($(du -h "$target" | cut -f1))"

# Newest KEEP dumps stay.
ls -1t "$BACKUP_DIR"/suwwara-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
