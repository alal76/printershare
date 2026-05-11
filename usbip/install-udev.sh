#!/usr/bin/env bash
# Beta test version v1.2.0
# install-udev.sh — Install printershare udev rules for USB hotplug
set -euo pipefail

RULES_SRC="$(dirname "$0")/99-printershare.rules"
RULES_DST="/etc/udev/rules.d/99-printershare.rules"
SCRIPT_SRC="$(dirname "$0")/ps-usb-bind.sh"
SCRIPT_DST="/usr/local/bin/ps-usb-bind.sh"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

cp "$SCRIPT_SRC" "$SCRIPT_DST"
chmod +x "$SCRIPT_DST"
cp "$RULES_SRC" "$RULES_DST"
udevadm control --reload-rules
udevadm trigger

echo "[OK] printershare udev rules installed."
