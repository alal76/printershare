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

# Check for systemd unit
if ! systemctl list-unit-files printershare-portal.service | grep -q printershare-portal; then
  echo "ERROR: printershare-portal.service not found. This deploy script only supports native/LXC deployments." >&2
  exit 1
fi

echo "==> Restarting printershare-portal service..."
systemctl restart printershare-portal

sleep 5

"${SCRIPT_DIR}/health-check.sh"

echo "==> Deployment complete."
