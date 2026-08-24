#!/usr/bin/env bash
# Beta test version v1.2.0
# ────────────────────────────────────────────────────────────────
# backup.sh — Back up config + state to a timestamped archive.
#
# Native/LXC (this project's primary target): backs up the portal env
# file, CUPS config, Samba config, sane-airscan's static network-scanner
# config, portal state (wizard-state.json, scanner-prefs.json), and scan
# files.
#
# Docker mode (legacy): backs up named volumes instead, same as before.
#
# Usage:
#   ./scripts/backup.sh [--dest <dir>] [--exclude-scans]
#
# Outputs:
#   ./backups/YYYY-MM-DD_HH-MM-SS.tar.gz
#
# Restore with scripts/restore.sh.
# ────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST_DIR="${DEST_DIR:-${REPO_ROOT}/backups}"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
TMP_DIR="$(mktemp -d)"
EXCLUDE_SCANS=0
LOG_FILE="/var/log/printershare-backup.log"
LOG_TAG="printershare-backup"

trap 'rm -rf "${TMP_DIR}"' EXIT

# ── Parse arguments ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)           DEST_DIR="$2"; shift 2 ;;
    --exclude-scans)  EXCLUDE_SCANS=1; shift ;;
    *)                echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "${DEST_DIR}"
ARCHIVE="${DEST_DIR}/${TIMESTAMP}.tar.gz"

is_native() {
  systemctl list-unit-files printershare-portal.service &>/dev/null
}

# ── Native/LXC: config + state files, no Docker involved ─────────────────
backup_native() {
  echo "==> Native/LXC backup"

  local portal_env="/etc/printershare/portal.env"
  [[ -f "${portal_env}" ]] && { echo "    portal.env..."; cp "${portal_env}" "${TMP_DIR}/portal.env"; }

  if [[ -d /etc/cups ]]; then
    echo "    CUPS config..."
    tar -czf "${TMP_DIR}/cups-config.tar.gz" -C /etc --exclude='cups/ssl/*.key' cups 2>/dev/null || \
      echo "    [warn] CUPS config backup had errors — continuing"
  fi

  [[ -f /etc/samba/smb.conf ]] && { echo "    Samba config..."; cp /etc/samba/smb.conf "${TMP_DIR}/smb.conf"; }
  [[ -f /etc/sane.d/airscan.conf ]] && { echo "    Network scanner config..."; cp /etc/sane.d/airscan.conf "${TMP_DIR}/airscan.conf"; }

  # Portal state lives at $PORTAL_DATA_DIR — new installs set this in the
  # systemd unit (/var/lib/printershare/portal-data); older installs never
  # set it and the portal falls back to its hardcoded /app/data default.
  # Try both rather than assuming one.
  local data_dir="${PORTAL_DATA_DIR:-}"
  if [[ -z "${data_dir}" ]]; then
    if [[ -d /var/lib/printershare/portal-data ]]; then
      data_dir=/var/lib/printershare/portal-data
    elif [[ -d /app/data ]]; then
      data_dir=/app/data
    fi
  fi
  if [[ -n "${data_dir}" && -d "${data_dir}" ]]; then
    echo "    Portal state (${data_dir})..."
    tar -czf "${TMP_DIR}/portal-data.tar.gz" -C "$(dirname "${data_dir}")" "$(basename "${data_dir}")"
  fi
}

# ── Docker mode: named volumes (legacy path) ──────────────────────────────
backup_docker() {
  echo "==> Docker-mode backup"
  local volumes=(
    cups-config cups-ppd portal-data ipp-usb-state rclone-config
    paperless-data paperless-media paperless-db paperless-redis tailscale-state
  )
  for vol in "${volumes[@]}"; do
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
  [[ -f "${REPO_ROOT}/.env" ]] && cp "${REPO_ROOT}/.env" "${TMP_DIR}/.env"
}

if is_native; then
  backup_native
else
  backup_docker
fi

# ── Scan files (both modes) ───────────────────────────────────────────────
if [[ "${EXCLUDE_SCANS}" -eq 0 ]]; then
  SCANS_PATH="${SCANS_HOST_PATH:-/srv/printershare/scans}"
  if [[ -d "${SCANS_PATH}" ]]; then
    echo "==> Backing up scan files from ${SCANS_PATH}..."
    tar -czf "${TMP_DIR}/scans.tar.gz" -C "${SCANS_PATH}" .
  else
    echo "    [skip] scan path ${SCANS_PATH} not found"
  fi
else
  echo "==> Skipping scan files (--exclude-scans)"
fi

echo "==> Creating archive ${ARCHIVE}..."
tar -czf "${ARCHIVE}" -C "${TMP_DIR}" .

SIZE="$(du -sh "${ARCHIVE}" | cut -f1)"
echo "==> Backup complete: ${ARCHIVE}"
echo "    Size: ${SIZE}"

# Remove backups older than 30 days
find "${DEST_DIR}" -name '*.tar.gz' -mtime +30 -delete && \
  echo "==> Old backups pruned (>30 days)."

{
  echo "=== $(date -Is) ==="
  echo "archive: ${ARCHIVE} (${SIZE})"
} >>"${LOG_FILE}" 2>/dev/null || true
command -v logger &>/dev/null && logger -t "${LOG_TAG}" "backup complete: ${ARCHIVE} (${SIZE})"
