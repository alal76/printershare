#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# install-native.sh — full bare-metal install on Ubuntu 22.04+  (no Docker)
#
# Installs: CUPS, SANE+saned, Scanservjs (Node.js), rclone,
#           Samba, NFS server, Nginx
#
# Usage: sudo bash install-native.sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Run as root: sudo bash $0"; exit 1; }

SCANS_DIR="/srv/printershare/scans"
NODE_VERSION="20"
RCLONE_VERSION="v1.67.0"
SCANSERVJS_DIR="/opt/scanservjs"

info()  { echo -e "\e[1;32m==>\e[0m $*"; }
warn()  { echo -e "\e[1;33mWARN:\e[0m $*"; }
die()   { echo -e "\e[1;31mERROR:\e[0m $*" >&2; exit 1; }

# ── System packages ──────────────────────────────────────────────────────
info "Updating packages..."
apt-get update -qq

info "Installing CUPS..."
apt-get install -y --no-install-recommends \
    cups cups-bsd cups-filters cups-pdf \
    foomatic-db foomatic-db-compressed-ppds foomatic-db-engine \
    printer-driver-gutenprint hplip \
    avahi-daemon avahi-utils dbus libnss-mdns

info "Installing SANE..."
apt-get install -y --no-install-recommends sane-utils libsane-dev imagemagick

info "Installing Samba..."
apt-get install -y --no-install-recommends samba samba-common-bin

info "Installing NFS server..."
apt-get install -y --no-install-recommends nfs-kernel-server

info "Installing Nginx..."
apt-get install -y --no-install-recommends nginx

apt-get install -y --no-install-recommends curl ca-certificates unzip git

# ── Node.js ──────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || \
   [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].replace("v",""))')" -lt 18 ]]; then
    info "Installing Node.js ${NODE_VERSION} via NodeSource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
fi
info "Node: $(node --version)"

# ── Scanservjs ───────────────────────────────────────────────────────────
info "Installing Scanservjs..."
if [[ ! -d "$SCANSERVJS_DIR" ]]; then
    git clone --branch release --depth 1 \
        https://github.com/sbs20/scanservjs.git "$SCANSERVJS_DIR"
fi
pushd "$SCANSERVJS_DIR" > /dev/null
npm install --omit=dev --silent
popd > /dev/null

mkdir -p "$SCANS_DIR" && chmod 777 "$SCANS_DIR"

[[ ! -f "${SCANSERVJS_DIR}/config/config.js" ]] && \
    cp "$(dirname "$0")/../scanservjs/config.js" "${SCANSERVJS_DIR}/config/config.js"

# ── rclone ───────────────────────────────────────────────────────────────
if ! command -v rclone &>/dev/null; then
    info "Installing rclone ${RCLONE_VERSION}..."
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64)  RCLONE_ARCH="amd64"  ;;
        aarch64) RCLONE_ARCH="arm64"  ;;
        armv7l)  RCLONE_ARCH="arm-v7" ;;
        *)       die "Unsupported arch: $ARCH" ;;
    esac
    curl -fsSL \
        "https://github.com/rclone/rclone/releases/download/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-${RCLONE_ARCH}.zip" \
        -o /tmp/rclone.zip
    unzip -q /tmp/rclone.zip -d /tmp/rclone_extract
    install -o root -g root -m 755 \
        "/tmp/rclone_extract/rclone-${RCLONE_VERSION}-linux-${RCLONE_ARCH}/rclone" \
        /usr/local/bin/rclone
    rm -rf /tmp/rclone.zip /tmp/rclone_extract
else
    info "rclone already installed: $(rclone --version | head -1)"
fi

install -o root -g root -m 755 \
    "$(dirname "$0")/../scanservjs/scripts/scan-save-upload.sh" \
    /usr/local/bin/scan-save-upload.sh

# ── CUPS ─────────────────────────────────────────────────────────────────
info "Configuring CUPS..."
cp "$(dirname "$0")/../cups/cupsd.conf" /etc/cups/cupsd.conf
systemctl enable --now cups && systemctl restart cups

# ── SANE daemon ──────────────────────────────────────────────────────────
info "Configuring saned..."
grep -q "0.0.0.0/0" /etc/sane.d/saned.conf 2>/dev/null || \
    echo "0.0.0.0/0" >> /etc/sane.d/saned.conf
systemctl enable --now saned.socket 2>/dev/null || \
    systemctl enable --now saned 2>/dev/null || \
    warn "saned service not found — start manually"

# Generate secure random credentials on first install (override via env vars).
SAMBA_USER="${SAMBA_USER:-scanner}"
SAMBA_PASS="${SAMBA_PASS:-$(openssl rand -hex 12)}"
PORTAL_PASS="${PORTAL_PASS:-$(openssl rand -hex 12)}"
PORTAL_SECRET="${PORTAL_SECRET:-$(openssl rand -hex 32)}"

# ── Samba ─────────────────────────────────────────────────────────────────
info "Configuring Samba..."
id "$SAMBA_USER" &>/dev/null || useradd -r -s /usr/sbin/nologin "$SAMBA_USER"
printf "%s\n%s\n" "$SAMBA_PASS" "$SAMBA_PASS" | smbpasswd -a -s "$SAMBA_USER"

cat >> /etc/samba/smb.conf <<SMBCONF

[Scans]
   comment      = Scanned Documents
   path         = ${SCANS_DIR}
   valid users  = ${SAMBA_USER}
   read only    = no
   browsable    = yes
   create mask  = 0666
   directory mask = 0777
SMBCONF
systemctl enable --now smbd nmbd && systemctl restart smbd nmbd

# ── NFS ───────────────────────────────────────────────────────────────────
info "Configuring NFS..."
grep -q "${SCANS_DIR}" /etc/exports 2>/dev/null || \
    echo "${SCANS_DIR} *(rw,sync,no_subtree_check,no_root_squash,insecure)" >> /etc/exports
exportfs -rav
systemctl enable --now nfs-kernel-server && systemctl restart nfs-kernel-server

# ── Nginx ─────────────────────────────────────────────────────────────────
info "Configuring Nginx..."
cp "$(dirname "$0")/../nginx/nginx.conf" /etc/nginx/sites-available/printershare
ln -sf /etc/nginx/sites-available/printershare /etc/nginx/sites-enabled/printershare
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx && systemctl reload nginx

# ── Scanservjs systemd service ────────────────────────────────────────────
info "Creating scanservjs service..."
cat > /etc/systemd/system/scanservjs.service <<UNIT
[Unit]
Description=Scanservjs Web Scanner UI
After=network.target

[Service]
Type=simple
WorkingDirectory=${SCANSERVJS_DIR}
ExecStart=$(command -v node) src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=8080
User=root

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now scanservjs

# ── Firewall ──────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
    info "Opening firewall ports..."
    for rule in "80/tcp:Nginx" "631/tcp:CUPS" "445/tcp:Samba" "139/tcp:Samba" "2049/tcp:NFS" "111/tcp:NFS" "111/udp:NFS"; do
        port="${rule%%:*}"
        label="${rule##*:}"
        ufw allow "$port" comment "$label" || true
    done
fi

SERVER_IP="$(hostname -I | awk '{print $1}')"

# Write portal env file with generated secrets (idempotent).
PORTAL_ENV="${PORTAL_ENV:-/etc/printershare/portal.env}"
mkdir -p "$(dirname "$PORTAL_ENV")"
[ -f "$PORTAL_ENV" ] || : >"$PORTAL_ENV"
_env_set_default() {
    local key="$1" val="$2"
    grep -q "^${key}=" "$PORTAL_ENV" || echo "${key}=${val}" >>"$PORTAL_ENV"
}
_env_set_default PORTAL_AUTH   "true"
_env_set_default PORTAL_USER   "admin"
_env_set_default PORTAL_PASS   "$PORTAL_PASS"
_env_set_default PORTAL_SECRET "$PORTAL_SECRET"
PORTAL_PASS_SHOW="$(grep '^PORTAL_PASS=' "$PORTAL_ENV" | cut -d= -f2-)"
PORTAL_USER_SHOW="$(grep '^PORTAL_USER=' "$PORTAL_ENV" | cut -d= -f2-)"

cat <<EOF

════════════════════════════════════════════════════
INSTALL COMPLETE  —  ${SERVER_IP}
════════════════════════════════════════════════════
 Scanner UI  : http://${SERVER_IP}/
 CUPS admin  : http://${SERVER_IP}:631/
 Samba share : \\\\${SERVER_IP}\\Scans  (${SAMBA_USER} / ${SAMBA_PASS})
 NFS mount   : ${SERVER_IP}:/srv/printershare/scans
 Portal auth : user=${PORTAL_USER_SHOW}  pass=${PORTAL_PASS_SHOW}
               (auth enabled — you will be prompted to set a new password on first login)

 Optional: bash scripts/setup-rclone.sh
 Optional: sudo bash scripts/install-usbip-server.sh
════════════════════════════════════════════════════
EOF
