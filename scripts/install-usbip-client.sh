#!/usr/bin/env bash
# Beta test version v1.2.0
# ═══════════════════════════════════════════════════════════════════════════
# install-usbip-client.sh
#
# Installs the USB/IP *client* tooling on the Docker host and creates a
# systemd unit that auto-attaches a remote USB device (e.g. a USB printer
# attached to a Raspberry Pi running scripts/install-usbip-server.sh, or
# an ESP32-S3 print server speaking the USB/IP protocol).
#
# Once attached, the device appears in /dev/bus/usb on this host so the
# CUPS, ipp-usb, and scanservjs containers can bind-mount it.
#
# Usage:
#   sudo bash scripts/install-usbip-client.sh <server-ip> <busid>
#
# Example:
#   sudo bash scripts/install-usbip-client.sh 192.168.0.42 1-1.4
#
# Find <busid> by running on this host after install:
#   sudo modprobe vhci-hcd && usbip list -r <server-ip>
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Run as root: sudo bash $0 <server-ip> <busid>"; exit 1; }
[[ $# -ne 2 ]] && { echo "Usage: sudo bash $0 <server-ip> <busid>"; exit 1; }

SERVER_IP="$1"
BUSID="$2"

# Validate inputs to avoid command injection in the systemd unit
if ! [[ "$SERVER_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    echo "ERROR: server-ip must be an IPv4 address (got: $SERVER_IP)" >&2
    exit 1
fi
if ! [[ "$BUSID" =~ ^[0-9a-zA-Z.\-]{1,32}$ ]]; then
    echo "ERROR: busid format invalid (got: $BUSID)" >&2
    exit 1
fi

# ── 1. Install packages ───────────────────────────────────────────────────
echo "==> Installing USB/IP client packages..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    linux-tools-generic \
    "linux-tools-$(uname -r)" \
    hwdata usbutils

# ── 2. Load vhci-hcd kernel module ────────────────────────────────────────
echo "==> Loading vhci-hcd kernel module..."
modprobe vhci-hcd
if ! grep -q "^vhci-hcd" /etc/modules 2>/dev/null; then
    echo "vhci-hcd" >> /etc/modules
fi

# ── 3. Locate usbip binary ────────────────────────────────────────────────
USBIP_PATH="$(find /usr/lib/linux-tools -name usbip 2>/dev/null | sort | tail -1)"
[[ -z "$USBIP_PATH" ]] && { echo "ERROR: usbip not found after install."; exit 1; }
ln -sf "$USBIP_PATH" /usr/local/sbin/usbip

# ── 4. Probe the remote server ────────────────────────────────────────────
echo "==> Probing $SERVER_IP for $BUSID..."
_usbip_list="$("$USBIP_PATH" list -r "$SERVER_IP" 2>/dev/null || true)"
if ! grep -q "${BUSID}:" <<<"$_usbip_list"; then
    echo "WARNING: busid $BUSID not currently exported by $SERVER_IP."
    echo "         The systemd unit will retry on every restart."
fi

# ── 5. Create attach-on-boot systemd unit ─────────────────────────────────
UNIT="/etc/systemd/system/usbip-attach@.service"
echo "==> Creating $UNIT..."
cat > "$UNIT" <<'UNIT_EOF'
[Unit]
Description=Attach remote USB device over USB/IP (%I)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
EnvironmentFile=/etc/default/usbip-attach-%i
ExecStartPre=/sbin/modprobe vhci-hcd
ExecStart=/usr/local/sbin/usbip attach -r ${SERVER_IP} -b ${BUSID}
ExecStop=/usr/local/sbin/usbip detach -p 0
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT_EOF

# Instance name = busid with dots/dashes preserved (systemd allows them)
INSTANCE="${BUSID}"
ENV_FILE="/etc/default/usbip-attach-${INSTANCE}"
echo "==> Writing $ENV_FILE..."
cat > "$ENV_FILE" <<EOF
SERVER_IP=${SERVER_IP}
BUSID=${BUSID}
EOF
chmod 600 "$ENV_FILE"

systemctl daemon-reload
systemctl enable --now "usbip-attach@${INSTANCE}.service"

# ── 6. Verify ─────────────────────────────────────────────────────────────
sleep 2
echo
echo "==> Result:"
_usbip_port="$("$USBIP_PATH" port 2>/dev/null || true)"
if grep -q "Remote busid" <<<"$_usbip_port"; then
    "$USBIP_PATH" port
    echo
    echo "==> Devices visible on this host:"
    lsusb | tail -5
    echo
    echo "Now restart the printer-using containers so they bind the new device:"
    echo "    cd ~/printershare && docker compose up -d"
else
    echo "Attach did not succeed.  Check:"
    echo "  systemctl status usbip-attach@${INSTANCE}.service"
    echo "  journalctl -u usbip-attach@${INSTANCE}.service -n 50"
fi
