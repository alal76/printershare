#!/bin/bash
# Beta test version v1.2.0
# Interactive wizard to configure rclone for Google Drive and OneDrive.
# Run on the server, or inside the container:
#   docker exec -it ps-scanservjs bash scripts/setup-rclone.sh
#
# Usage:
#   bash scripts/setup-rclone.sh          # setup wizard
#   bash scripts/setup-rclone.sh --test   # test existing config
set -euo pipefail

MODE="${1:-setup}"
GDRIVE_REMOTE="gdrive"
ONEDRIVE_REMOTE="onedrive"

command -v rclone &>/dev/null || {
    echo "ERROR: rclone not installed."
    echo "  curl https://rclone.org/install.sh | sudo bash"
    exit 1
}

if [[ "$MODE" == "--test" ]]; then
    _remotes="$(rclone listremotes)"
    for REMOTE in "$GDRIVE_REMOTE" "$ONEDRIVE_REMOTE"; do
        if grep -qE "^${REMOTE}:" <<<"$_remotes"; then
            echo -n "  [${REMOTE}] Testing... "
            rclone lsd "${REMOTE}:" --max-depth 1 &>/dev/null && echo "OK" || echo "FAILED"
        else
            echo "  [${REMOTE}] Not configured."
        fi
    done
    exit 0
fi

configure_remote() {
    local REMOTE="$1" LABEL="$2"
    local _remotes; _remotes="$(rclone listremotes 2>/dev/null || true)"
    if grep -qE "^${REMOTE}:" <<<"$_remotes"; then
        read -rp "  Remote '${REMOTE}' exists. Reconfigure? [y/N]: " R
        [[ ! "$R" =~ ^[Yy]$ ]] && return
    fi
    echo ""
    echo "  Starting rclone config for ${LABEL}."
    echo "  When prompted for remote name enter: ${REMOTE}"
    read -rp "  Press ENTER to continue..."
    rclone config
    rclone lsd "${REMOTE}:" --max-depth 1 &>/dev/null && \
        echo "  OK: ${LABEL} configured." || \
        echo "  WARN: could not verify ${LABEL}."
}

read -rp "Configure Google Drive? [Y/n]: " R
[[ ! "$R" =~ ^[Nn]$ ]] && configure_remote "$GDRIVE_REMOTE" "Google Drive"

read -rp "Configure Microsoft OneDrive? [Y/n]: " R
[[ ! "$R" =~ ^[Nn]$ ]] && configure_remote "$ONEDRIVE_REMOTE" "Microsoft OneDrive"

for REMOTE in "$GDRIVE_REMOTE" "$ONEDRIVE_REMOTE"; do
    _remotes="$(rclone listremotes 2>/dev/null || true)"
    grep -qE "^${REMOTE}:" <<<"$_remotes" && \
        rclone mkdir "${REMOTE}:Scans" 2>/dev/null && \
        echo "  Created ${REMOTE}:Scans" || true
done

echo ""
echo "  Test: bash scripts/setup-rclone.sh --test"
