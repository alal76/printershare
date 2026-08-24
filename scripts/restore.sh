#!/usr/bin/env bash
# Beta test version v1.2.0
# ────────────────────────────────────────────────────────────────
# restore.sh — Restore a backup archive created by scripts/backup.sh.
#
# Native/LXC only. Destructive: overwrites live config and portal state.
# Restarts affected services (cups, smbd, printershare-portal) so the
# restored config takes effect immediately.
#
# Usage:
#   ./scripts/restore.sh <archive.tar.gz> [--yes]
#
# --yes skips the confirmation prompt (for scripted use); otherwise the
# script lists what it's about to overwrite and asks first.
# ────────────────────────────────────────────────────────────────
set -euo pipefail

[[ $EUID -ne 0 ]] && { echo "Run as root: sudo bash $0 <archive.tar.gz>" >&2; exit 1; }

ARCHIVE="${1:-}"
ASSUME_YES=0
for arg in "$@"; do
  [[ "$arg" == "--yes" ]] && ASSUME_YES=1
done

if [[ -z "${ARCHIVE}" || ! -f "${ARCHIVE}" ]]; then
  echo "Usage: sudo bash $0 <archive.tar.gz> [--yes]" >&2
  exit 1
fi

if ! systemctl list-unit-files printershare-portal.service &>/dev/null; then
  echo "ERROR: restore.sh only supports native/LXC deployments (printershare-portal.service not found)." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "==> Extracting ${ARCHIVE}..."
tar -xzf "${ARCHIVE}" -C "${TMP_DIR}"

echo
echo "The following will be restored, overwriting the current live state:"
[[ -f "${TMP_DIR}/portal.env" ]]        && echo "  - /etc/printershare/portal.env"
[[ -f "${TMP_DIR}/cups-config.tar.gz" ]] && echo "  - /etc/cups/"
[[ -f "${TMP_DIR}/smb.conf" ]]          && echo "  - /etc/samba/smb.conf"
[[ -f "${TMP_DIR}/airscan.conf" ]]      && echo "  - /etc/sane.d/airscan.conf"
[[ -f "${TMP_DIR}/portal-data.tar.gz" ]] && echo "  - portal state (wizard-state.json, scanner-prefs.json)"
[[ -f "${TMP_DIR}/scans.tar.gz" ]]      && echo "  - scan files (merged into the current scans directory)"
echo

if [[ "${ASSUME_YES}" -ne 1 ]]; then
  read -r -p "Continue? [y/N] " confirm
  [[ "${confirm}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

if [[ -f "${TMP_DIR}/portal.env" ]]; then
  echo "==> Restoring portal.env..."
  mkdir -p /etc/printershare
  cp "${TMP_DIR}/portal.env" /etc/printershare/portal.env
fi

if [[ -f "${TMP_DIR}/cups-config.tar.gz" ]]; then
  echo "==> Restoring CUPS config..."
  tar -xzf "${TMP_DIR}/cups-config.tar.gz" -C /etc
fi

if [[ -f "${TMP_DIR}/smb.conf" ]]; then
  echo "==> Restoring Samba config..."
  cp "${TMP_DIR}/smb.conf" /etc/samba/smb.conf
fi

if [[ -f "${TMP_DIR}/airscan.conf" ]]; then
  echo "==> Restoring network scanner config..."
  cp "${TMP_DIR}/airscan.conf" /etc/sane.d/airscan.conf
fi

if [[ -f "${TMP_DIR}/portal-data.tar.gz" ]]; then
  echo "==> Restoring portal state..."
  data_dir="${PORTAL_DATA_DIR:-}"
  if [[ -z "${data_dir}" ]]; then
    if [[ -d /var/lib/printershare/portal-data ]]; then data_dir=/var/lib/printershare/portal-data
    else data_dir=/app/data
    fi
  fi
  mkdir -p "$(dirname "${data_dir}")"
  tar -xzf "${TMP_DIR}/portal-data.tar.gz" -C "$(dirname "${data_dir}")"
fi

if [[ -f "${TMP_DIR}/scans.tar.gz" ]]; then
  echo "==> Restoring scan files..."
  SCANS_PATH="${SCANS_HOST_PATH:-/srv/printershare/scans}"
  mkdir -p "${SCANS_PATH}"
  tar -xzf "${TMP_DIR}/scans.tar.gz" -C "${SCANS_PATH}"
fi

echo "==> Restarting affected services..."
systemctl restart cups 2>/dev/null || true
systemctl restart smbd nmbd 2>/dev/null || true
systemctl restart printershare-portal

echo "==> Restore complete."
