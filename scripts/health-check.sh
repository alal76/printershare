#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# health-check.sh — Verify portal and CUPS are responding
#
# Usage:
#   ./scripts/health-check.sh [--host <host>] [--port <port>]
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
# ────────────────────────────────────────────────────────────────
set -euo pipefail

# Default to nginx (port 80) which fronts the portal API, static assets,
# and CUPS admin. Only override if you've published the portal directly.
HOST="${PORTAL_HOST:-localhost}"
PORT="${PORTAL_PORT:-80}"
RETRIES=10
WAIT=3
FAILURES=0

# ── Parse arguments ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    *)      echo "Unknown option: $1"; exit 1 ;;
  esac
done

BASE_URL="http://${HOST}:${PORT}"

check() {
  local name="$1"
  local url="$2"
  local expected="${3:-200}"

  for i in $(seq 1 "${RETRIES}"); do
    local status
    status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${url}" 2>/dev/null || echo 000)"
    if [[ "${status}" == "${expected}" ]]; then
      echo "  [OK]  ${name} → ${status}"
      return 0
    fi
    echo "  [${i}/${RETRIES}] ${name} → ${status} (retrying in ${WAIT}s…)"
    sleep "${WAIT}"
  done

  echo "  [FAIL] ${name} failed after ${RETRIES} attempts"
  FAILURES=$(( FAILURES + 1 ))
}

echo "==> Health checks against ${BASE_URL}"
check "Portal API"       "${BASE_URL}/api/v1/health"
check "Static assets"   "${BASE_URL}/"
check "CUPS (nginx)"    "${BASE_URL}/cups/"             302

echo ""
if [[ "${FAILURES}" -gt 0 ]]; then
  echo "==> ${FAILURES} check(s) FAILED."
  exit 1
else
  echo "==> All checks passed."
fi
