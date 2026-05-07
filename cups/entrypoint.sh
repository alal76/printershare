#!/bin/bash
# CUPS container entrypoint
# Starts D-Bus, Avahi, then CUPS, then registers IPP Everywhere printers
set -euo pipefail

CUPSADMIN="${CUPSADMIN:-admin}"
CUPSPASSWORD="${CUPSPASSWORD:-changeme}"
IPP_USB_HOST="${IPP_USB_HOST:-localhost}"
IPP_USB_PORT="${IPP_USB_PORT:-60000}"

# ── Create admin user ──────────────────────────────────────────────
if ! id "$CUPSADMIN" &>/dev/null; then
    useradd -r -G lpadmin,sys "$CUPSADMIN"
fi
echo "${CUPSADMIN}:${CUPSPASSWORD}" | chpasswd

# ── Start D-Bus (required by Avahi) ───────────────────────────────
mkdir -p /run/dbus /var/run/dbus
dbus-daemon --system --fork 2>/dev/null || true
sleep 1

# ── Start Avahi for Bonjour/mDNS announcements ─────────────────────
if command -v avahi-daemon &>/dev/null; then
    avahi-daemon --no-chroot --daemonize 2>/dev/null || true
fi

# ── Start CUPS in background, wait for it, then register printers ──
/usr/sbin/cupsd -f &
CUPS_PID=$!

# Wait for CUPS to be ready
for i in $(seq 1 30); do
    curl -sf http://localhost:631/ >/dev/null 2>&1 && break
    sleep 1
done

# ── Register IPP Everywhere printer from ipp-usb ────────────────────
# ipp-usb exposes USB printer as IPP at port 60000.
# This enables AirPrint (iOS/macOS) and Mopria (Android) discovery.
register_ipp_everywhere() {
    local ipp_url="ipp://${IPP_USB_HOST}:${IPP_USB_PORT}/ipp/print"
    # Probe ipp-usb endpoint
    if curl -sf --max-time 5 "http://${IPP_USB_HOST}:${IPP_USB_PORT}/ipp/print" >/dev/null 2>&1 || \
       curl -sf --max-time 5 "http://${IPP_USB_HOST}:${IPP_USB_PORT}/" >/dev/null 2>&1; then
        # Get printer name from ipp-usb if possible, fallback to generic
        PRINTER_NAME="USB-Printer"
        if ! lpstat -p "$PRINTER_NAME" >/dev/null 2>&1; then
            lpadmin -p "$PRINTER_NAME" \
                    -E \
                    -v "${ipp_url}" \
                    -m everywhere \
                    -D "USB Printer (AirPrint/Mopria)"
            cupsenable  "$PRINTER_NAME" 2>/dev/null || true
            cupsaccept  "$PRINTER_NAME" 2>/dev/null || true
            echo "[cups] Registered '${PRINTER_NAME}' as IPP Everywhere (AirPrint) via ${ipp_url}"
        else
            echo "[cups] '${PRINTER_NAME}' already registered"
        fi
    else
        echo "[cups] ipp-usb not reachable at ${IPP_USB_HOST}:${IPP_USB_PORT} — skipping auto-register"
        echo "[cups] Use the portal wizard or CUPS admin to add the printer manually"
    fi
}

register_ipp_everywhere

echo "CUPS admin : ${CUPSADMIN}"
echo "CUPS UI    : http://0.0.0.0:631"

# Keep container alive
wait $CUPS_PID
