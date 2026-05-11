#!/usr/bin/env bash
# Beta test version v1.2.0
# ============================================================================
#  sane-usb-init.sh — Generic SANE USB backend initialisation
# ----------------------------------------------------------------------------
#  Installed as /etc/cont-init.d/01-sane-usb-init inside the scanservjs
#  container (s6-overlay style).  Runs once at container startup, BEFORE
#  the scanservjs service starts, so backends are fully configured when
#  scanimage -L is first called.
#
#  What it does:
#   1. Reads /app/device-quirks.json (mounted from the repo at runtime).
#   2. Iterates over every USB device visible via `lsusb`.
#   3. For each matched device:
#      a. If scan.sane_usb_conf is true, adds the USB ID to the preferred
#         backend's .conf file (needed for backends like smfp that do NOT
#         auto-enumerate via libusb — unlike hpaio, pixma, epson2 which do).
#      b. Applies scan.sane_blacklist: comments out competing backends in
#         /etc/sane.d/dll.conf when the preferred backend's .conf is present.
#   4. Exits 0 so s6-overlay continues to start scanservjs normally.
#
#  Gracefully degrades if lsusb, jq, or device-quirks.json are absent
#  (container starts with unconfigured SANE, which is correct when no USB
#  devices are attached or no quirks apply).
#
#  Environment overrides:
#    QUIRKS_FILE   Path to device-quirks.json  (default: /app/device-quirks.json)
#    DLL_CONF      Path to dll.conf             (default: /etc/sane.d/dll.conf)
#    SANE_DIR      Directory of backend confs   (default: /etc/sane.d)
# ============================================================================
set -euo pipefail

QUIRKS_FILE="${QUIRKS_FILE:-/app/device-quirks.json}"
DLL_CONF="${DLL_CONF:-/etc/sane.d/dll.conf}"
SANE_DIR="${SANE_DIR:-/etc/sane.d}"

_log() { echo "[sane-init] $*" >&2; }

# ── Graceful early-out if prerequisites are missing ─────────────────────────
if ! command -v lsusb >/dev/null 2>&1; then
  _log "lsusb not available — skipping SANE USB init (no USB pass-through?)"
  exit 0
fi
if ! command -v jq >/dev/null 2>&1; then
  _log "jq not installed — skipping SANE USB init"
  exit 0
fi
if [[ ! -r "$QUIRKS_FILE" ]]; then
  _log "device-quirks.json not found at $QUIRKS_FILE — skipping"
  exit 0
fi

# ── Helper: resolve quirks record for a VID:PID ─────────────────────────────
# Returns JSON on stdout or empty string on miss.
# Tries exact key first, then vendor wildcard "vid:*".
_lookup() {
  local key="$1" vendor="${1%%:*}" rec
  rec=$(jq -c --arg k "$key"       '.devices[$k] // empty' "$QUIRKS_FILE")
  [[ -n "$rec" ]] && { printf '%s' "$rec"; return; }
  jq -c --arg k "${vendor}:*" '.devices[$k] // empty' "$QUIRKS_FILE"
}

# ── Iterate over all connected USB devices ──────────────────────────────────
declare -A _seen=()

while read -r vid pid; do
  key="${vid,,}:${pid,,}"
  [[ -n "${_seen[$key]:-}" ]] && continue
  _seen[$key]=1

  rec=$(_lookup "$key")
  [[ -z "$rec" ]] && continue

  name=$(jq -r '.name // "(unknown)"' <<<"$rec")
  backend=$(jq -r '.scan.sane_backend // empty' <<<"$rec")
  _log "Detected: $name ($key)"

  # ── (a) Add USB ID to backend .conf if required ────────────────────────
  # Some older backends (smfp, genesys, etc.) need explicit "usb VID PID"
  # lines in their .conf files; modern libusb-aware backends (hpaio, pixma,
  # epson2, brother4) enumerate automatically and do NOT need this.
  if [[ "$(jq -r '.scan.sane_usb_conf // false' <<<"$rec")" == "true" \
     && -n "$backend" ]]; then
    conf_file="$SANE_DIR/${backend}.conf"
    # Only patch if the backend package is installed (conf file exists)
    if [[ -f "$conf_file" ]]; then
      if ! grep -q "0x${pid,,}" "$conf_file" 2>/dev/null; then
        printf '\n# auto-configured by sane-usb-init: %s\nusb 0x%s 0x%s\n' \
          "$name" "${vid,,}" "${pid,,}" >> "$conf_file"
        _log "  Added USB 0x${vid,,}:0x${pid,,} to ${backend}.conf"
      else
        _log "  USB 0x${vid,,}:0x${pid,,} already in ${backend}.conf"
      fi
    else
      _log "  Backend '${backend}' not installed (no ${backend}.conf) — skipping USB conf patch"
    fi
  fi

  # ── (b) Blacklist competing SANE backends in dll.conf ──────────────────
  # Only blacklist when the preferred backend is confirmed installed, so
  # we never disable the only working backend for a device.
  if [[ -n "$backend" && -f "$SANE_DIR/${backend}.conf" && -f "$DLL_CONF" ]]; then
    while IFS= read -r bl; do
      [[ -z "$bl" ]] && continue
      if grep -qE "^\s*${bl}\b" "$DLL_CONF" 2>/dev/null; then
        sed -i "s|^\(\s*\)\(${bl}\b\)|\1# \2 # disabled by sane-usb-init|" "$DLL_CONF"
        _log "  Blacklisted SANE backend: $bl (prefers $backend for $name)"
      fi
    done < <(jq -r '.scan.sane_blacklist // [] | .[]' <<<"$rec")
  fi

done < <(lsusb 2>/dev/null \
  | grep -oE 'ID [0-9a-fA-F]{4}:[0-9a-fA-F]{4}' \
  | awk -F'[: ]' '{print $2, $3}')

_log "SANE USB init complete"
exit 0
