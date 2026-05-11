#!/usr/bin/env bash
# Beta test version v1.2.0
# ============================================================================
#  apply-device-quirks.sh — consume portal/server/data/device-quirks.json and
#  reconcile the host's SANE / CUPS configuration with the recorded fixes for
#  every USB device currently attached.
# ----------------------------------------------------------------------------
#  Replaces the hardcoded "Samsung SCX-3400 needs xerox_mfp commented out"
#  block that used to live in scripts/proxmox/install.sh. New device fixes
#  are added by editing the JSON catalogue — no shell edits required.
#
#  Behaviour:
#    1. Enumerate connected USB devices (lsusb).
#    2. For each VID:PID, look up an entry in the quirks catalogue
#       (exact match → vendor wildcard → none).
#    3. Apply `scan.sane_usb_conf`: if true, add the device's USB ID to
#       the preferred backend's .conf file (for backends that require
#       explicit USB IDs — e.g. smfp — unlike auto-enumerate backends).
#    4. Apply `scan.sane_blacklist`: comment out the named SANE backends in
#       /etc/sane.d/dll.conf when the device's preferred backend is present.
#    5. Print, one per line, every apt package referenced by matched entries
#       so the caller can `xargs apt-get install` them.
#
#  Inputs (env vars, all optional):
#    QUIRKS_FILE   Path to device-quirks.json
#                  (default: ../portal/server/data/device-quirks.json relative
#                   to the script, or $REPO_DIR if set).
#    DLL_CONF      Path to SANE dll.conf (default: /etc/sane.d/dll.conf).
#    SANE_DIR      Directory containing per-backend confs (default: /etc/sane.d).
#    APPLY_BLACKLIST   1 to edit dll.conf (default), 0 to dry-run.
#
#  Output:
#    stdout: deduplicated list of apt packages to install (one per line)
#    stderr: human-readable progress (info / warn lines)
#    exit code: 0 on success, non-zero if jq or the catalogue is missing
#
#  Example:
#    pkgs=$(scripts/apply-device-quirks.sh) && \
#      [[ -n "$pkgs" ]] && apt-get install -y $pkgs
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

QUIRKS_FILE="${QUIRKS_FILE:-$REPO_ROOT/portal/server/data/device-quirks.json}"
DLL_CONF="${DLL_CONF:-/etc/sane.d/dll.conf}"
SANE_DIR="${SANE_DIR:-/etc/sane.d}"
APPLY_BLACKLIST="${APPLY_BLACKLIST:-1}"

info() { echo -e "\e[1;32m==>\e[0m apply-device-quirks: $*" >&2; }
warn() { echo -e "\e[1;33mWARN:\e[0m apply-device-quirks: $*" >&2; }

command -v jq    >/dev/null || { warn "jq not installed — cannot parse catalogue"; exit 0; }
command -v lsusb >/dev/null || { warn "lsusb not installed — cannot enumerate USB devices"; exit 0; }
[[ -r "$QUIRKS_FILE" ]] || { warn "quirks catalogue not found at $QUIRKS_FILE"; exit 0; }

# ── Resolve quirks record for a single VID:PID ──────────────────────────────
# Prints the JSON record (one line) or empty on miss. Tries exact match,
# then vendor wildcard "vid:*".
lookup_quirks() {
    local key="$1"
    local vendor="${key%%:*}"
    local rec
    rec=$(jq -c --arg k "$key"  '.devices[$k] // empty'         "$QUIRKS_FILE")
    [[ -n "$rec" ]] && { echo "$rec"; return; }
    rec=$(jq -c --arg k "${vendor}:*" '.devices[$k] // empty'   "$QUIRKS_FILE")
    [[ -n "$rec" ]] && echo "$rec"
}

# ── Comment out a SANE backend in dll.conf ──────────────────────────────────
# Idempotent: only edits the file if the backend line is still uncommented.
blacklist_backend() {
    local backend="$1"
    [[ -f "$DLL_CONF" ]] || return 0
    if grep -qE "^\s*${backend}\b" "$DLL_CONF"; then
        if [[ "$APPLY_BLACKLIST" == "1" ]]; then
            sed -ri "s/^(\s*)(${backend}\b)/\1# \2 # disabled by apply-device-quirks/" "$DLL_CONF"
            info "blacklisted SANE backend: $backend"
        else
            info "would blacklist SANE backend: $backend (dry-run)"
        fi
    fi
}

# ── Collect apt packages from a quirks record ───────────────────────────────
emit_packages() {
    local rec="$1"
    jq -r '
        ( .print.packages // [] ) + ( .scan.packages // [] )
        | .[]
    ' <<<"$rec"
}

# ── Main loop ───────────────────────────────────────────────────────────────
declare -A SEEN_PKGS=()
declare -A SEEN_VIDPID=()
matched_count=0

while read -r vid pid; do
    key="${vid,,}:${pid,,}"
    [[ -n "${SEEN_VIDPID[$key]:-}" ]] && continue
    SEEN_VIDPID[$key]=1

    rec=$(lookup_quirks "$key" || true)
    [[ -z "$rec" ]] && continue
    matched_count=$((matched_count + 1))

    name=$(jq -r '.name // "(unnamed)"' <<<"$rec")
    preferred=$(jq -r '.scan.sane_backend // empty' <<<"$rec")
    info "matched $key → $name"

    # Apply sane_usb_conf: add explicit USB ID to backend .conf for backends
    # that do not auto-enumerate via libusb (e.g. smfp). Idempotent.
    if [[ "$(jq -r '.scan.sane_usb_conf // false' <<<"$rec")" == "true" \
       && -n "$preferred" && -f "$SANE_DIR/${preferred}.conf" ]]; then
        if ! grep -q "0x${pid,,}" "$SANE_DIR/${preferred}.conf" 2>/dev/null; then
            if [[ "$APPLY_BLACKLIST" == "1" ]]; then
                printf '\n# auto-configured by apply-device-quirks: %s\nusb 0x%s 0x%s\n' \
                    "$name" "${vid,,}" "${pid,,}" >> "$SANE_DIR/${preferred}.conf"
                info "added USB ID ${vid,,}:${pid,,} to ${preferred}.conf"
            else
                info "would add USB ID ${vid,,}:${pid,,} to ${preferred}.conf (dry-run)"
            fi
        fi
    fi

    # Apply sane_blacklist only when the preferred backend is actually present,
    # otherwise we may disable the only working backend on systems without
    # the vendor driver installed.
    if [[ -n "$preferred" && -f "$SANE_DIR/${preferred}.conf" ]]; then
        while read -r bl; do
            [[ -n "$bl" ]] && blacklist_backend "$bl"
        done < <(jq -r '.scan.sane_blacklist // [] | .[]' <<<"$rec")
    elif [[ -n "$preferred" ]]; then
        info "preferred backend '$preferred' not installed yet — deferring blacklist"
    fi

    while read -r pkg; do
        [[ -n "$pkg" ]] && SEEN_PKGS[$pkg]=1
    done < <(emit_packages "$rec")
done < <(lsusb | grep -oE 'ID [0-9a-fA-F]{4}:[0-9a-fA-F]{4}' | sed -E 's/^ID //; s/:/ /')

info "$matched_count device(s) matched the quirks catalogue"

for pkg in "${!SEEN_PKGS[@]}"; do
    echo "$pkg"
done
