#!/bin/bash
# Beta test version v1.2.0
# ═══════════════════════════════════════════════════════════════════════════
# install-usbip-server.sh
#
# Installs and configures USB/IP server on Ubuntu/Debian.
# Allows Windows, macOS, and Linux clients to use the physical USB
# printer/scanner over the LAN as if it were locally attached.
#
# Usage: sudo bash install-usbip-server.sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Run as root: sudo bash $0"; exit 1; }

# ── 1. Install packages ───────────────────────────────────────────────────
echo "==> Installing USB/IP packages..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    linux-tools-generic \
    "linux-tools-$(uname -r)" \
    hwdata usbutils

# ── 2. Load kernel modules ────────────────────────────────────────────────
echo "==> Loading kernel modules..."
modprobe usbip_core || true
modprobe usbip_host || true
modprobe vhci-hcd   || true

if ! grep -q "usbip_host" /etc/modules 2>/dev/null; then
    printf "usbip_core\nusbip_host\n" >> /etc/modules
fi

# ── 3. Create systemd service ─────────────────────────────────────────────
echo "==> Creating usbipd systemd service..."
USBIPD_PATH="$(find /usr/lib/linux-tools -name usbipd 2>/dev/null | sort | tail -1)"
[[ -z "$USBIPD_PATH" ]] && { echo "ERROR: usbipd not found after install."; exit 1; }

cat > /etc/systemd/system/usbipd.service <<UNIT
[Unit]
Description=USB/IP Device Server
After=network.target

[Service]
Type=forking
ExecStartPre=/sbin/modprobe usbip_core
ExecStartPre=/sbin/modprobe usbip_host
ExecStart=${USBIPD_PATH} --daemon
ExecStartPost=/bin/bash -c 'sleep 2; usbip list -l | awk "/busid/{print \$3}" | xargs -I{} usbip bind -b {}'
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now usbipd.service

# ── 4. Open firewall ─────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
    ufw allow 3240/tcp comment "USB/IP" || true
fi

# ── 5. Bind all USB devices ───────────────────────────────────────────────
echo "==> Binding detected USB devices..."
usbip list -l | awk '/busid/{print $3}' | while read -r busid; do
    echo "    Binding: $busid"
    usbip bind -b "$busid" 2>/dev/null || true
done

SERVER_IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

════════════════════════════════════════════════════
USB/IP SERVER RUNNING  —  ${SERVER_IP}:3240
════════════════════════════════════════════════════

List devices:  usbip list -r ${SERVER_IP}
Linux attach:  sudo usbip attach -r ${SERVER_IP} -b <busid>
Windows:       usbip-win or usbipkit GUI — server ${SERVER_IP}
macOS:         bash clients/client-macos.sh ${SERVER_IP} usbip

════════════════════════════════════════════════════
EOF
