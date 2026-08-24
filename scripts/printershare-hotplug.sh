#!/usr/bin/env bash
# Beta test version v1.2.0
# ============================================================================
# printershare-hotplug.sh — re-checks the device-quirks catalogue whenever
# the set of attached USB devices changes, and installs any newly-required
# apt packages.
#
# Without this, driver detection (apply-device-quirks.sh) only ran once, at
# install time — swapping in a different USB printer/scanner afterwards
# left it with no driver until someone re-ran the installer or the setup
# wizard by hand.
#
# Triggered on a short interval by printershare-hotplug.timer rather than a
# udev rule: inside an unprivileged Proxmox LXC container (this project's
# primary deployment target) /sys is not writable, so systemd-udevd cannot
# run and udev rules never fire. Polling `lsusb` is the one mechanism that
# works identically on bare metal and inside LXC. The script is a fast
# no-op (~one `lsusb` call) whenever the USB device set hasn't changed
# since the last run, so a short interval costs nothing.
#
# Safe to run repeatedly / concurrently — apply-device-quirks.sh is
# idempotent and this script flock's itself.
# ============================================================================
set -euo pipefail

REPO_DIR="${PRINTERSHARE_REPO_DIR:-/opt/printershare}"
LOG_FILE="/var/log/printershare-hotplug.log"
LOCK_FILE="/run/printershare-hotplug.lock"
STATE_DIR="/var/lib/printershare"
STATE_FILE="$STATE_DIR/hotplug-seen.txt"
LOG_TAG="printershare-hotplug"

mkdir -p "$STATE_DIR"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0  # another run still in progress — skip this tick

command -v lsusb >/dev/null 2>&1 || exit 0

CURRENT="$(lsusb 2>/dev/null | grep -oE 'ID [0-9a-fA-F]{4}:[0-9a-fA-F]{4}' | sed 's/^ID //' | sort -u)"
PREVIOUS=""
[[ -f "$STATE_FILE" ]] && PREVIOUS="$(cat "$STATE_FILE")"

if [[ "$CURRENT" == "$PREVIOUS" ]]; then
    exit 0  # USB device set unchanged since last check — nothing to do
fi
echo "$CURRENT" > "$STATE_FILE"

QUIRKS_SCRIPT="$REPO_DIR/scripts/apply-device-quirks.sh"
if [[ ! -x "$QUIRKS_SCRIPT" ]]; then
    logger -t "$LOG_TAG" "apply-device-quirks.sh not found at $QUIRKS_SCRIPT — skipping"
    exit 0
fi

logger -t "$LOG_TAG" "USB device set changed — checking quirks catalogue"
PKGS="$("$QUIRKS_SCRIPT" 2>>"$LOG_FILE" || true)"

MISSING=""
for pkg in $PKGS; do
    dpkg -s "$pkg" >/dev/null 2>&1 || MISSING="$MISSING $pkg"
done

if [[ -z "$MISSING" ]]; then
    logger -t "$LOG_TAG" "no new driver packages needed"
    exit 0
fi

logger -t "$LOG_TAG" "installing:$MISSING"
if {
    echo "=== $(date -Is) — installing:$MISSING ==="
    apt-get update -qq
    # shellcheck disable=SC2086
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $MISSING
} >>"$LOG_FILE" 2>&1; then
    logger -t "$LOG_TAG" "installed:$MISSING"
else
    logger -t "$LOG_TAG" "install FAILED for:$MISSING — see $LOG_FILE"
fi

# Re-run quirks now that the preferred SANE backend(s) may be newly
# installed, so sane_blacklist entries get applied on this pass too.
"$QUIRKS_SCRIPT" >/dev/null 2>>"$LOG_FILE" || true
