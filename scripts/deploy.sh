#!/usr/bin/env bash
# Beta test version v1.2.0
# ────────────────────────────────────────────────────────────────
# deploy.sh — Pull latest code and restart the PrinterShare portal (native/LXC only)
#
# Usage:
#   ./scripts/deploy.sh
# ────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Pulling latest changes..."
git pull --ff-only

echo "==> Building portal assets..."
(cd portal && npm ci --silent && npm run build && rm -rf public && cp -r dist public)

# Check for systemd unit. `systemctl cat` exits non-zero if the unit
# doesn't exist and needs no pipe — piping to `grep -q` here is a classic
# pipefail trap: -q can close its stdin as soon as it matches, SIGPIPEing
# the writer, which pipefail then reports as a failure even though the
# check actually succeeded (intermittent, since it depends on scheduling).
if ! systemctl cat printershare-portal.service &>/dev/null; then
  echo "ERROR: printershare-portal.service not found. This deploy script only supports native/LXC deployments." >&2
  exit 1
fi

echo "==> Restarting printershare-portal service..."
systemctl restart printershare-portal

sleep 5

"${SCRIPT_DIR}/health-check.sh"

echo "==> Deployment complete."
