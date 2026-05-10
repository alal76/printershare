#!/usr/bin/env bash
# ============================================================================
#  printershare — in-LXC installer  (Debian 12)
# ----------------------------------------------------------------------------
#  Runs INSIDE a fresh Debian 12 container created by `printershare.sh` on the
#  Proxmox host.  Installs every printershare component as a native service:
#
#    * CUPS                 systemd  cups.service           :631
#    * Avahi                systemd  avahi-daemon.service   mDNS
#    * SANE + scanservjs    systemd  scanservjs.service     :8080
#    * Portal (Node)        systemd  printershare-portal    :3000
#    * Nginx (front door)   systemd  nginx.service          :80
#    * Samba                systemd  smbd / nmbd            :445
#    * NFS (optional)       systemd  nfs-kernel-server      :2049
#
#  Idempotent — safe to re-run after a `git pull`.
# ============================================================================
set -euo pipefail

[[ $EUID -ne 0 ]] && { echo "Run as root"; exit 1; }

# ── Tunables ────────────────────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/alal76/printershare.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
REPO_DIR="${REPO_DIR:-/opt/printershare}"
SCANS_DIR="${SCANS_DIR:-/srv/printershare/scans}"
SCANSERVJS_DIR="/opt/scanservjs"
NODE_MAJOR="${NODE_MAJOR:-20}"
RCLONE_VERSION="${RCLONE_VERSION:-v1.67.0}"
SAMBA_USER="${SAMBA_USER:-scanner}"
SAMBA_PASS="${SAMBA_PASS:-scanner123}"
PORTAL_PORT="${PORTAL_PORT:-3000}"
SCANSERVJS_PORT="${SCANSERVJS_PORT:-8080}"
AIRSANE_PORT="${AIRSANE_PORT:-8090}"
AIRSANE_DIR="/opt/AirSane"

info()  { echo -e "\e[1;32m==>\e[0m $*"; }
warn()  { echo -e "\e[1;33mWARN:\e[0m $*"; }
die()   { echo -e "\e[1;31mERROR:\e[0m $*" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive

# ── Repo ────────────────────────────────────────────────────────────────────
info "Cloning / refreshing $REPO_URL ($REPO_BRANCH)"
if [[ ! -d "$REPO_DIR/.git" ]]; then
    apt-get update -qq
    apt-get install -y --no-install-recommends git ca-certificates curl >/dev/null
    git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
else
    git -C "$REPO_DIR" fetch --depth 1 origin "$REPO_BRANCH"
    git -C "$REPO_DIR" reset --hard "origin/$REPO_BRANCH"
fi

# ── Locale (avoid perl warnings during apt) ─────────────────────────────────
if ! locale -a 2>/dev/null | grep -qi '^en_US\.utf-\?8$'; then
    info "Generating en_US.UTF-8 locale"
    apt-get install -y --no-install-recommends locales >/dev/null
    sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
    locale-gen en_US.UTF-8 >/dev/null
    update-locale LANG=en_US.UTF-8
fi
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# ── Base packages ───────────────────────────────────────────────────────────
info "Installing core packages (cups, avahi, sane, nginx, samba)"
apt-get update -qq
apt-get install -y --no-install-recommends \
    cups cups-bsd cups-filters cups-pdf cups-client \
    avahi-daemon avahi-utils libnss-mdns dbus \
    sane-utils sane-airscan libsane1 \
    imagemagick ghostscript poppler-utils tesseract-ocr \
    samba samba-common-bin \
    nfs-kernel-server \
    nginx \
    usbutils \
    unzip jq

info "Installing printer drivers (foomatic, gutenprint, hplip)"
# NB: foomatic-db and foomatic-db-compressed-ppds CONFLICT on Debian 12
# (they ship overlapping PPD files), so we install only foomatic-db.
apt-get install -y --no-install-recommends \
    foomatic-db foomatic-db-engine \
    printer-driver-gutenprint printer-driver-cups-pdf hplip \
    || warn "Some printer drivers failed to install — CUPS may still work for IPP-capable devices"

info "Installing AirSane build toolchain"
apt-get install -y --no-install-recommends \
    build-essential cmake g++ pkg-config \
    libsane-dev libavahi-client-dev libjpeg-dev libpng-dev zlib1g-dev libusb-1.0-0-dev

# Blacklist usblp — it competes with CUPS/SANE for the USB interface.
echo "blacklist usblp" >/etc/modprobe.d/blacklist-usblp.conf
modprobe -r usblp 2>/dev/null || true

# ── Node.js ─────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null || \
   [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))')" -lt 18 ]]; then
    info "Installing Node.js $NODE_MAJOR"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
    apt-get install -y nodejs >/dev/null
fi
info "node: $(node --version)   npm: $(npm --version)"

# ── rclone (for cloud upload of scans, optional) ────────────────────────────
if ! command -v rclone >/dev/null; then
    info "Installing rclone $RCLONE_VERSION"
    arch="$(uname -m)"
    case "$arch" in
        x86_64)  ra=amd64 ;;
        aarch64) ra=arm64 ;;
        armv7l)  ra=arm-v7 ;;
        *) die "unsupported arch $arch" ;;
    esac
    curl -fsSL "https://github.com/rclone/rclone/releases/download/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-${ra}.zip" -o /tmp/rclone.zip
    unzip -qo /tmp/rclone.zip -d /tmp/rclone_x
    install -m 755 "/tmp/rclone_x/rclone-${RCLONE_VERSION}-linux-${ra}/rclone" /usr/local/bin/rclone
    rm -rf /tmp/rclone.zip /tmp/rclone_x
fi

# ── Scans dir ───────────────────────────────────────────────────────────────
mkdir -p "$SCANS_DIR" && chmod 0777 "$SCANS_DIR"

# ── CUPS configuration ──────────────────────────────────────────────────────
info "Configuring CUPS"
cp -f "$REPO_DIR/cups/cupsd.conf" /etc/cups/cupsd.conf
# CUPS web UI requires the lp / lpadmin groups to exist.
groupadd -f lpadmin
usermod -aG lpadmin root
systemctl enable --now cups
systemctl restart cups

# ── Avahi (mDNS/Bonjour for printer + share discovery) ──────────────────────
systemctl enable --now avahi-daemon

# ── Samsung Unified Linux Driver (ULD) ──────────────────────────────────────
# The community Debian repo at bchemnet.com/suldr packages Samsung's
# proprietary print + scan driver (smfp SANE backend). The open-source
# xerox_mfp backend fails to scan on M-series devices like the SCX-3400
# (bulk-IN times out), so we install the ULD for reliable scanning. The
# keyring ships as suldr-keyring_4_all.deb; download + dpkg -i it first,
# then the apt repo becomes verifiable.
info "Installing Samsung Unified Linux Driver (ULD)"
if ! dpkg -s suldr-keyring &>/dev/null; then
    KEYRING_DEB=$(mktemp --suffix=.deb)
    if wget -qO "$KEYRING_DEB" https://www.bchemnet.com/suldr/pool/debian/extra/su/suldr-keyring_4_all.deb; then
        dpkg -i "$KEYRING_DEB" || warn "suldr-keyring install failed"
    else
        warn "Could not fetch suldr-keyring .deb — skipping ULD install"
    fi
    rm -f "$KEYRING_DEB"
fi
if dpkg -s suldr-keyring &>/dev/null && [[ ! -f /etc/apt/sources.list.d/suldr.list ]]; then
    echo "deb https://www.bchemnet.com/suldr/ debian extra" \
        >/etc/apt/sources.list.d/suldr.list
    apt-get update -qq || true
fi
if dpkg -s suldr-keyring &>/dev/null && ! dpkg -s suld-driver2-1.00.39 &>/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq suld-driver2-1.00.39 || \
        warn "ULD package install failed — scanner may not work"
fi

# ── SANE: append Samsung SCX-3400 USB ID if missing ─────────────────────────
# Enable the xerox_mfp backend in dll.conf (Debian ships it commented out
# on some installs). Without this, scanimage -L returns "no scanners".
# Note: ULD installs the smfp backend; we keep xerox_mfp enabled as a
# fallback for other Samsung devices that may be plugged in later.
if grep -qE '^#\s*xerox_mfp\b' /etc/sane.d/dll.conf 2>/dev/null; then
    sed -ri 's/^#\s*(xerox_mfp)\b/\1/' /etc/sane.d/dll.conf
elif ! grep -qE '^\s*xerox_mfp\b' /etc/sane.d/dll.conf 2>/dev/null; then
    echo 'xerox_mfp' >>/etc/sane.d/dll.conf
fi
if ! grep -q '0x344f' /etc/sane.d/xerox_mfp.conf 2>/dev/null; then
    info "Adding Samsung SCX-3400 (04e8:344f) to xerox_mfp backend"
    {
        echo
        echo '# printershare: Samsung SCX-3400 Series'
        echo 'usb 0x04e8 0x344f'
    } >>/etc/sane.d/xerox_mfp.conf
fi
# saned (network scanner) — bind on all interfaces; nginx fronts it.
grep -q '^0\.0\.0\.0/0' /etc/sane.d/saned.conf 2>/dev/null || \
    echo '0.0.0.0/0' >>/etc/sane.d/saned.conf

# ── Auto-add USB printer queue to CUPS ──────────────────────────────────────
# Discover any USB printer and register it with CUPS if not already present.
# Uses driverless / IPP-everywhere when possible; falls back to a Samsung
# generic PPD shipped with the ULD for SCX-series devices.
info "Detecting USB printers"
sleep 2  # give cups time to enumerate after restart
PRINTER_URI="$(lpinfo -v 2>/dev/null | awk '/^direct usb:/{print $2; exit}')"
if [[ -n "$PRINTER_URI" ]] && ! lpstat -p 2>/dev/null | grep -q '^printer .* USB'; then
    # Try driverless first (works for most modern devices, including SCX).
    PRINTER_NAME="$(echo "$PRINTER_URI" | sed -E 's|.*/([^?]+).*|\1|; s/[^A-Za-z0-9_-]/_/g')"
    info "Adding CUPS queue $PRINTER_NAME → $PRINTER_URI"
    if ! lpadmin -p "$PRINTER_NAME" -E -v "$PRINTER_URI" -m everywhere 2>/dev/null; then
        # Fall back to Samsung generic PPD from ULD if everywhere fails.
        # The apt-installed ULD lands its PPDs in /usr/share/ppd/suld/.
        PPD="$(find /usr/share/ppd/suld /opt/Samsung/mfp/share/ppd -name '*SCX-3400*' 2>/dev/null | head -1)"
        [[ -z "$PPD" ]] && PPD="$(find /usr/share/ppd/suld /opt/Samsung/mfp/share/ppd -iname '*samsung*scx*' 2>/dev/null | head -1)"
        if [[ -n "$PPD" ]]; then
            lpadmin -p "$PRINTER_NAME" -E -v "$PRINTER_URI" -P "$PPD" || \
                warn "lpadmin failed with PPD $PPD"
        else
            warn "No PPD found for $PRINTER_URI — printer queue not created"
        fi
    fi
    cupsenable "$PRINTER_NAME" 2>/dev/null || true
    cupsaccept "$PRINTER_NAME" 2>/dev/null || true
fi

# ── Scanservjs ──────────────────────────────────────────────────────────────
# Upstream restructured the repo (app-server/ + app-ui/ instead of server/)
# and the official install path is now the bootstrap script, which builds
# a deb, installs it with all dependencies, and registers its own systemd
# unit `scanservjs.service` listening on :8080.
info "Installing scanservjs (official bootstrap → deb)"
if ! dpkg -s scanservjs &>/dev/null; then
    curl -fsSL https://raw.githubusercontent.com/sbs20/scanservjs/master/bootstrap.sh \
        | bash -s -- -v latest
fi
# Drop our config + post-scan hook into the package install dir.
SCANSERVJS_ETC=/etc/scanservjs
mkdir -p "$SCANSERVJS_ETC"
cp -f "$REPO_DIR/scanservjs/config.js" "$SCANSERVJS_ETC/config.local.js"
install -m 755 "$REPO_DIR/scanservjs/scripts/scan-save-upload.sh" /usr/local/bin/scan-save-upload.sh
# Remove any stale unit from a previous (broken) git-build install.
if [[ -f /etc/systemd/system/scanservjs.service ]] && \
   grep -q '/opt/scanservjs' /etc/systemd/system/scanservjs.service 2>/dev/null; then
    rm -f /etc/systemd/system/scanservjs.service
    systemctl daemon-reload
fi

# ── AirSane (eSCL / AirScan bridge for SANE scanners) ───────────────────────
# Exposes /etc/sane.d backends as Apple AirScan / Mopria eSCL endpoints with
# Bonjour _uscan._tcp + _uscans._tcp registration, so macOS / iOS / Windows
# discover the scanner natively (no driver install).
info "Installing AirSane (eSCL bridge)"
if [[ ! -d "$AIRSANE_DIR/.git" ]]; then
    git clone --depth 1 https://github.com/SimulPiscator/AirSane.git "$AIRSANE_DIR"
else
    git -C "$AIRSANE_DIR" fetch --depth 1 origin
    git -C "$AIRSANE_DIR" reset --hard origin/HEAD
fi
if [[ ! -x /usr/local/bin/airsaned ]] || [[ "$AIRSANE_DIR/.git/HEAD" -nt /usr/local/bin/airsaned ]]; then
    info "Building AirSane"
    mkdir -p "$AIRSANE_DIR/build"
    ( cd "$AIRSANE_DIR/build" && cmake .. -DCMAKE_BUILD_TYPE=Release >/dev/null && make -j"$(nproc)" >/dev/null )
    install -m 755 "$AIRSANE_DIR/build/airsaned" /usr/local/bin/airsaned
fi

cat >/etc/systemd/system/airsane.service <<UNIT
[Unit]
Description=AirSane — eSCL / AirScan bridge for SANE
After=network.target avahi-daemon.service saned.socket
Wants=avahi-daemon.service
# Both AirSane and scanservjs talk to SANE backends, so they can't scan at
# the same time on a single-interface USB device. The DeviceLock layer in
# the portal disables CUPS during scans; AirSane / scanservjs themselves
# serialize on the SANE handle, which is fine.

[Service]
Type=simple
ExecStart=/usr/local/bin/airsaned --listen-port=$AIRSANE_PORT --interface=any --mdns-announce=true --web-interface=true --hotplug=true
Restart=on-failure
RestartSec=3
# Needs access to /dev/bus/usb (provided by the LXC passthrough block).
User=root

[Install]
WantedBy=multi-user.target
UNIT

# ── Portal (Express + built Vue assets) ─────────────────────────────────────
info "Building portal"
cd "$REPO_DIR/portal"
npm ci --silent
npm run build --silent
# The Express server serves the SPA from portal/public/ (matches the
# Docker stage that does `COPY dist ./public`). On native installs we
# build into portal/dist/ and need to mirror it into public/, preserving
# the static manifest.json + icons already shipped in public/.
mkdir -p "$REPO_DIR/portal/public"
cp -rf "$REPO_DIR/portal/dist/." "$REPO_DIR/portal/public/"

cat >/etc/systemd/system/printershare-portal.service <<UNIT
[Unit]
Description=PrinterShare Portal (Express + Vue)
After=network.target cups.service scanservjs.service

[Service]
Type=simple
WorkingDirectory=$REPO_DIR/portal
ExecStart=$(command -v node) server/index.js
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=$PORTAL_PORT
Environment=CUPS_LOCAL=1
Environment=CUPS_HOST=127.0.0.1
Environment=CUPS_PORT=631
Environment=SCANSERVJS_URL=http://127.0.0.1:$SCANSERVJS_PORT
Environment=SCANS_PATH=$SCANS_DIR
User=root

[Install]
WantedBy=multi-user.target
UNIT

# ── Nginx site (native, replaces the docker nginx config) ───────────────────
info "Configuring nginx"
SERVER_NAME="$(hostname -f 2>/dev/null || hostname)"
cat >/etc/nginx/sites-available/printershare <<NGINX
# printershare — native LXC deployment
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 64M;

    # Built Vue SPA + Express API (portal serves both)
    location / {
        proxy_pass         http://127.0.0.1:$PORTAL_PORT;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }

    # Scanservjs UI + WebSocket (kept reachable for power users)
    location /scan/ {
        rewrite            ^/scan/(.*)\$ /\$1 break;
        proxy_pass         http://127.0.0.1:$SCANSERVJS_PORT;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              \$host;
        proxy_read_timeout 300s;
    }

    # CUPS web admin (loopback only by default — see cupsd.conf)
    location /cups/ {
        proxy_pass         http://127.0.0.1:631/;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
    }

    # AirSane web UI + eSCL endpoints (proxied for portal access; native
    # Bonjour discovery on port $AIRSANE_PORT remains the primary path).
    location /escl/ {
        proxy_pass         http://127.0.0.1:$AIRSANE_PORT/;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_read_timeout 300s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/printershare /etc/nginx/sites-enabled/printershare
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# ── Samba ───────────────────────────────────────────────────────────────────
info "Configuring Samba (\\\\$SERVER_NAME\\Scans)"
id "$SAMBA_USER" &>/dev/null || useradd -r -M -N -s /usr/sbin/nologin -g nogroup "$SAMBA_USER"
printf '%s\n%s\n' "$SAMBA_PASS" "$SAMBA_PASS" | smbpasswd -a -s "$SAMBA_USER" >/dev/null
if ! grep -q '^\[Scans\]' /etc/samba/smb.conf; then
    cat >>/etc/samba/smb.conf <<SMB

[Scans]
   comment        = PrinterShare scans
   path           = $SCANS_DIR
   valid users    = $SAMBA_USER
   read only      = no
   browsable      = yes
   create mask    = 0666
   directory mask = 0777
SMB
fi
systemctl enable --now smbd nmbd
systemctl restart smbd nmbd

# ── NFS (best-effort — fails silently in unprivileged LXCs) ─────────────────
if grep -q 'kernel_nfsd' /proc/filesystems 2>/dev/null || modprobe nfsd 2>/dev/null; then
    grep -q "$SCANS_DIR" /etc/exports 2>/dev/null || \
        echo "$SCANS_DIR *(rw,sync,no_subtree_check,no_root_squash,insecure)" >>/etc/exports
    exportfs -rav || true
    systemctl enable --now nfs-kernel-server || warn "nfs-kernel-server failed (likely unprivileged LXC)"
else
    warn "NFS kernel module unavailable — skipping NFS export"
fi

# ── Enable + (re)start the new units ────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now scanservjs.service
# NOTE: airsane is intentionally NOT enabled. The Samsung ULD's smfp SANE
# backend uses libusb in a way that segfaults inside airsaned (it dereferences
# a freed device handle when libusb_get_device_descriptor races the smfp
# init). The crash leaves the USB endpoint in a half-claimed state, which
# also breaks subsequent scanimage calls until a USB reset. scanservjs uses
# the same backend but spawns scanimage as a subprocess, so the crash (if
# any) is isolated. Until upstream airsane gains an option to skip smfp or
# we patch it, we ship without it. Apple AirScan still works via the eSCL
# proxy in nginx → scanservjs at /escl/ (TODO).
systemctl disable airsane.service 2>/dev/null || true
systemctl mask airsane.service 2>/dev/null || true
systemctl enable --now printershare-portal.service
# On re-runs (git pull → rebuild), the units exist and are running but with
# stale code; force a restart so the new build/config takes effect.
systemctl restart scanservjs.service
systemctl restart printershare-portal.service

# ── Summary ─────────────────────────────────────────────────────────────────
ip="$(hostname -I | awk '{print $1}')"
cat <<EOF

══════════════════════════════════════════════════════════════
  printershare — install complete
══════════════════════════════════════════════════════════════
  Portal      : http://$ip/
  CUPS admin  : http://$ip:631/   (loopback by default)
  Scanservjs  : http://$ip/scan/
  AirSane     : http://$ip/escl/  (eSCL/AirScan on Bonjour _uscan._tcp)
  Samba share : \\\\$ip\\Scans     (user: $SAMBA_USER)

  Detected scanners:
$(scanimage -L 2>/dev/null | sed 's/^/    /' || echo '    (none yet — plug in printer/scanner)')

  Detected printers:
$(lpstat -p 2>/dev/null | sed 's/^/    /' || echo '    (none yet — add via http://$ip:631/)')

  Logs:
    journalctl -u printershare-portal -f
    journalctl -u scanservjs -f
    journalctl -u cups -f
══════════════════════════════════════════════════════════════
EOF
