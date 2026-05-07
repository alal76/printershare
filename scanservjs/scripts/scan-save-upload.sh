#!/bin/bash
# Called by scanservjs after each scan. Uploads the file to every
# configured rclone remote (Google Drive, OneDrive).
#
# Usage: scan-save-upload.sh <path-to-file>
set -euo pipefail

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
    echo "[upload] No file or file not found: '$FILE'" >&2
    exit 0
fi

FILENAME="$(basename "$FILE")"
GDRIVE_REMOTE="${RCLONE_GDRIVE_REMOTE:-gdrive}"
ONEDRIVE_REMOTE="${RCLONE_ONEDRIVE_REMOTE:-onedrive}"
UPLOAD_DIR="Scans/$(date +%Y-%m-%d)"

upload_to_remote() {
    local remote="$1"
    if rclone listremotes 2>/dev/null | grep -qE "^${remote}:"; then
        echo "[upload] Uploading '$FILENAME' to ${remote}:${UPLOAD_DIR}/ ..."
        if rclone copy "$FILE" "${remote}:${UPLOAD_DIR}/" \
                --log-level INFO --timeout 60s --retries 3; then
            echo "[upload] OK: ${remote}"
        else
            echo "[upload] FAILED: ${remote}" >&2
        fi
    else
        echo "[upload] Remote '${remote}' not configured — skipping" >&2
    fi
}

upload_to_remote "$GDRIVE_REMOTE"
upload_to_remote "$ONEDRIVE_REMOTE"
echo "[upload] Done."
