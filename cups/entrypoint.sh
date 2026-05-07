#!/bin/bash
# CUPS container entrypoint — starts D-Bus, Avahi, then CUPS
set -euo pipefail

CUPSADMIN="${CUPSADMIN:-admin}"
CUPSPASSWORD="${CUPSPASSWORD:-changeme}"

# Create admin user
if ! id "$CUPSADMIN" &>/dev/null; then
    useradd -r -G lpadmin,sys "$CUPSADMIN"
fi
echo "${CUPSADMIN}:${CUPSPASSWORD}" | chpasswd

# Start D-Bus (required by Avahi)
mkdir -p /run/dbus /var/run/dbus
dbus-daemon --system --fork 2>/dev/null || true
sleep 1

# Start Avahi for Bonjour/mDNS printer announcements
if command -v avahi-daemon &>/dev/null; then
    avahi-daemon --no-chroot --daemonize 2>/dev/null || true
fi

echo "CUPS admin : ${CUPSADMIN}"
echo "CUPS UI    : http://0.0.0.0:631"
exec /usr/sbin/cupsd -f
