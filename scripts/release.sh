#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# release.sh — Bump version, tag, and push a new release
#
# Usage:
#   ./scripts/release.sh <major|minor|patch>
#
# Requirements:
#   - Clean working tree (no uncommitted changes)
#   - npm (for version bump in package.json)
#   - git remote 'origin' configured with push access
# ────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUMP_TYPE="${1:-patch}"

cd "${REPO_ROOT}"

# ── Validate bump type ────────────────────────────────────────────
if [[ ! "${BUMP_TYPE}" =~ ^(major|minor|patch)$ ]]; then
  echo "Usage: $0 <major|minor|patch>"
  exit 1
fi

# ── Ensure working tree is clean ──────────────────────────────────
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# ── Bump portal/package.json version ─────────────────────────────
echo "==> Bumping ${BUMP_TYPE} version in portal/package.json..."
cd portal
NEW_VERSION="$(npm version "${BUMP_TYPE}" --no-git-tag-version | tr -d 'v')"
cd "${REPO_ROOT}"

# Keep repository-wide version file in sync.
echo "${NEW_VERSION}" > VERSION

TAG="v${NEW_VERSION}"
echo "==> New version: ${TAG}"

# ── Commit + tag ─────────────────────────────────────────────────
git add portal/package.json portal/package-lock.json VERSION
git commit -m "chore: release ${TAG}"
git tag -a "${TAG}" -m "Release ${TAG}"

echo "==> Pushing commit and tag to origin..."
git push origin HEAD
git push origin "${TAG}"

echo ""
echo "==> Release ${TAG} created and pushed."
echo "    GitHub Actions will build the Docker image and create the release."
