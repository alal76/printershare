#!/usr/bin/env bash
# Beta test version v1.2.0
# ============================================================================
# scan-purge.sh — deletes scan files older than SCANS_RETENTION_DAYS.
#
# Runs daily via printershare-scan-purge.timer. Retention is configurable
# through the portal's Settings page (Storage & Retention) or by editing
# SCANS_RETENTION_DAYS in the portal env file directly. A value of 0 or
# blank disables purging (keep everything).
#
# Deleted-file details go to /var/log/printershare-scan-purge.log (rotated
# by /etc/logrotate.d/printershare); a one-line summary also goes to the
# journal via `logger` for `journalctl -t printershare-scan-purge`.
# ============================================================================
set -euo pipefail

PORTAL_ENV="${PORTAL_ENV:-/etc/printershare/portal.env}"
# shellcheck disable=SC1090
[[ -f "$PORTAL_ENV" ]] && { set -a; source "$PORTAL_ENV"; set +a; }

SCANS_DIR="${SCANS_HOST_PATH:-/srv/printershare/scans}"
RETENTION_DAYS="${SCANS_RETENTION_DAYS:-14}"
LOG_FILE="/var/log/printershare-scan-purge.log"
LOG_TAG="printershare-scan-purge"

if [[ -z "$RETENTION_DAYS" || "$RETENTION_DAYS" -le 0 ]]; then
    logger -t "$LOG_TAG" "retention disabled (SCANS_RETENTION_DAYS=${RETENTION_DAYS:-0}) — nothing purged"
    exit 0
fi

if [[ ! -d "$SCANS_DIR" ]]; then
    logger -t "$LOG_TAG" "scans directory $SCANS_DIR not found — skipping"
    exit 0
fi

COUNT=0
BYTES=0
while IFS= read -r -d '' f; do
    SZ="$(stat -c%s "$f" 2>/dev/null || echo 0)"
    BYTES=$((BYTES + SZ))
    COUNT=$((COUNT + 1))
    rm -f -- "$f"
done < <(find "$SCANS_DIR" -maxdepth 1 -type f -mtime "+${RETENTION_DAYS}" -print0)

{
    echo "=== $(date -Is) ==="
    echo "retention: ${RETENTION_DAYS} days"
    echo "deleted:   ${COUNT} file(s), $((BYTES / 1024 / 1024))MB"
} >>"$LOG_FILE" 2>/dev/null || true

logger -t "$LOG_TAG" "deleted ${COUNT} file(s) older than ${RETENTION_DAYS}d, freed ~$((BYTES / 1024 / 1024))MB"
