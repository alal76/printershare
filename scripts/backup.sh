#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# backup.sh — Back up Docker volumes and .env to a timestamped archive
#
# Usage:
#   ./scripts/backup.sh [--dest <dir>] [--env-file <path>]
#
# Outputs:
#   ./backups/YYYY-MM-DD_HH-MM-SS.tar.gz
# ────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
DEST_DIR="${REPO_ROOT}/backups"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
TMP_DIR="$(mktemp -d)"

# ── Parse arguments ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)     DEST_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2";  shift 2 ;;
    *)          echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "${DEST_DIR}"
ARCHIVE="${DEST_DIR}/${TIMESTAMP}.tar.gz"

echo "==> Backing up .env..."
[[ -f "${ENV_FILE}" ]] && cp "${ENV_FILE}" "${TMP_DIR}/.env"

echo "==> Backing up named Docker volumes..."
VOLUMES=(
  printershare_cups-data
  printershare_scans
  printershare_paperless-data
  printershare_paperless-db-data
  printershare_samba-data
)
for vol in "${VOLUMES[@]}"; do
  if docker volume inspect "${vol}" &>/dev/null; then
    echo "    ${vol}..."
    docker run --rm \
      -v "${vol}:/data:ro" \
      -v "${TMP_DIR}:/backup" \
      busybox tar -czf "/backup/${vol}.tar.gz" -C /data .
  else
    echo "    [skip] ${vol} not found"
  fi
done

echo "==> Creating archive ${ARCHIVE}..."
tar -czf "${ARCHIVE}" -C "${TMP_DIR}" .
rm -rf "${TMP_DIR}"

echo "==> Backup complete: ${ARCHIVE}"
echo "    Size: $(du -sh "${ARCHIVE}" | cut -f1)"

# Remove backups older than 30 days
find "${DEST_DIR}" -name '*.tar.gz' -mtime +30 -delete && \
  echo "==> Old backups pruned (>30 days)."
