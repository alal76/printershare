#!/usr/bin/env bash
# Beta test version v1.2.0
# ps-usb-bind.sh — Called by udev when a USB device is attached.
# Logs the event; real binding is handled by ipp-usb inside Docker.
set -euo pipefail

DEVNAME="${1:-unknown}"
LOG="/var/log/printershare-usb.log"

echo "$(date -Iseconds) USB device attached: $DEVNAME" >> "$LOG"

# Notify the portal (non-blocking)
curl -sf --max-time 3 -X POST http://localhost:3000/api/v1/system/usb-event \
  -H 'Content-Type: application/json' \
  -d "{\"device\": \"$DEVNAME\"}" || true
