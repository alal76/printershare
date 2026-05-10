#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# deploy.sh — Pull latest code and restart the Docker Compose stack
#
# Usage:
#   ./scripts/deploy.sh [--no-build] [--env-file <path>]
#
# Options:
#   --no-build     Skip docker compose build (use cached images)
#   --env-file     Path to .env file (default: .env)
# ────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
BUILD=true

# ── Parse arguments ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build)    BUILD=false; shift ;;
    --env-file)    ENV_FILE="$2"; shift 2 ;;
    *)             echo "Unknown option: $1"; exit 1 ;;
  esac
done

cd "${REPO_ROOT}"

echo "==> Pulling latest changes..."
git pull --ff-only

echo "==> Building portal assets..."
(cd portal && npm ci --silent && npm run build)

if [[ "${BUILD}" == "true" ]]; then
  echo "==> Building Docker images..."
  docker compose --env-file "${ENV_FILE}" build --parallel
fi

echo "==> Restarting services..."
docker compose --env-file "${ENV_FILE}" up -d --remove-orphans

# Single-file bind mounts (e.g. nginx.conf) are pinned to the inode they had
# when the container started.  `git pull` rewrites those files (new inode),
# so containers that bind-mount them must be restarted to see the change.
echo "==> Restarting containers with bind-mounted config files..."
docker compose --env-file "${ENV_FILE}" restart nginx >/dev/null 2>&1 || true

echo "==> Waiting for health check..."
sleep 5
"${SCRIPT_DIR}/health-check.sh"

echo "==> Deployment complete."
