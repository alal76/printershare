#!/usr/bin/env bash
# Beta test version v1.2.0
# ============================================================================
#  printershare — in-LXC installer (Debian 12, native only)
# ----------------------------------------------------------------------------
#  Runs INSIDE a fresh Debian 12 container created by `printershare.sh` on the
#  Proxmox host. Installs every PrinterShare component as a native systemd service (no Docker):
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
# Generate a secure random Samba password on first run unless caller pre-sets one.
SAMBA_PASS="${SAMBA_PASS:-$(openssl rand -hex 12)}"
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

# ── Avahi (mDNS/Bonjour for printer + share discovery) ──────────────────────
# Started before CUPS deliberately: cupsd registers its AirPrint/IPP DNS-SD
# records with avahi once, at startup, and does not retry. Starting them in
# the other order (as this script used to) meant every fresh install lost
# that race deterministically — the printer would come up but never be
# discoverable via AirPrint/IPP-Everywhere until something later restarted
# cups by hand.
systemctl enable --now avahi-daemon

# ── CUPS configuration ──────────────────────────────────────────────────────
info "Configuring CUPS"
cp -f "$REPO_DIR/cups/cupsd.conf" /etc/cups/cupsd.conf
# CUPS web UI requires the lp / lpadmin groups to exist.
groupadd -f lpadmin
usermod -aG lpadmin root

# Belt-and-braces for every subsequent boot, not just this install: an
# explicit ordering dependency so a future reboot can't lose the same race
# regardless of which order systemd happens to start things in.
mkdir -p /etc/systemd/system/cups.service.d
install -o root -g root -m 644 \
    "$REPO_DIR/scripts/systemd/cups.service.d/avahi-order.conf" \
    /etc/systemd/system/cups.service.d/avahi-order.conf
systemctl daemon-reload

systemctl enable --now cups
systemctl restart cups

# ── Per-device vendor apt repos (driven by device-quirks.json) ─────────────
# Some devices require vendor-specific apt repositories that are not in the
# standard Debian archive (e.g. Samsung ULD at bchemnet.com/suldr).
# The quirks catalogue records these under the `apt_repo` key; we bootstrap
# only the repos whose devices are currently attached — keeps the install
# fast and minimal on hosts that don't need them.
# Adding support for a new vendor repo is a JSON edit (device-quirks.json),
# not a shell change.
if command -v jq >/dev/null && [[ -r "$REPO_DIR/portal/server/data/device-quirks.json" ]]; then
    QCAT="$REPO_DIR/portal/server/data/device-quirks.json"
    info "Checking for device-specific apt repos (connected USB devices)..."
    _repo_bootstrapped=0
    while read -r vid pid; do
        key="${vid,,}:${pid,,}"
        vendor="${vid,,}"
        # Try exact match, then vendor wildcard
        rec=""
        for _k in "$key" "${vendor}:*"; do
            _r=$(jq -c --arg k "$_k" '.devices[$k] // empty' "$QCAT" 2>/dev/null)
            if [[ -n "$_r" ]]; then rec="$_r"; break; fi
        done
        [[ -z "$rec" ]] && continue

        # Read apt_repo fields (empty string → not present)
        repo_sources_file=$(jq -r '.apt_repo.sources_file  // empty' <<<"$rec")
        repo_sources_entry=$(jq -r '.apt_repo.sources_entry // empty' <<<"$rec")
        repo_keyring_url=$(jq  -r '.apt_repo.keyring_url   // empty' <<<"$rec")
        [[ -z "$repo_sources_file" ]] && continue

        name=$(jq -r '.name // "(unknown)"' <<<"$rec")

        # Idempotent: skip if sources file already exists
        if [[ -f "/etc/apt/sources.list.d/$repo_sources_file" ]]; then
            info "$name: apt repo already configured (${repo_sources_file})"
            continue
        fi

        info "$name: bootstrapping apt repo → $repo_sources_entry"

        # Install signing keyring if a keyring deb URL is given
        if [[ -n "$repo_keyring_url" ]]; then
            KEYRING_DEB=$(mktemp --suffix=.deb)
            if wget -qO "$KEYRING_DEB" "$repo_keyring_url"; then
                dpkg -i "$KEYRING_DEB" || warn "Keyring install failed for $name — repo may not be trusted"
            else
                warn "Could not fetch keyring for $name (${repo_keyring_url}) — skipping repo"
                rm -f "$KEYRING_DEB"
                continue
            fi
            rm -f "$KEYRING_DEB"
        fi

        echo "$repo_sources_entry" > "/etc/apt/sources.list.d/$repo_sources_file"
        info "$name: apt repo written to /etc/apt/sources.list.d/$repo_sources_file"
        _repo_bootstrapped=1

    done < <(lsusb 2>/dev/null \
        | grep -oE 'ID [0-9a-fA-F]{4}:[0-9a-fA-F]{4}' \
        | awk -F'[: ]' '{print $2, $3}')

    if [[ "$_repo_bootstrapped" -eq 1 ]]; then
        apt-get update -qq || true
    fi
fi

# ── SANE quirks + per-device package install (driven by quirks catalogue) ──
# All per-device fixes live in portal/server/data/device-quirks.json. The
# helper script enumerates connected USB devices, applies any
# scan.sane_blacklist entries to /etc/sane.d/dll.conf, and prints the union
# of apt packages those devices need. Adding a new device fix is a JSON
# edit — no shell changes required.
# ── USB hotplug driver detection ────────────────────────────────────────
# Polls (every 20s) for USB device-set changes and re-runs the quirks
# catalogue against them, so a printer/scanner swapped in after this
# install gets its driver installed automatically instead of needing a
# manual re-run of this script. Uses a systemd timer rather than a udev
# rule: inside an unprivileged LXC container /sys is not writable, so
# systemd-udevd cannot run and udev rules never fire — polling `lsusb` is
# the mechanism that actually works here.
info "Installing USB hotplug driver detection..."
install -o root -g root -m 755 \
    "$REPO_DIR/scripts/printershare-hotplug.sh" \
    /usr/local/bin/printershare-hotplug.sh
install -o root -g root -m 644 \
    "$REPO_DIR/scripts/systemd/printershare-hotplug.service" \
    /etc/systemd/system/printershare-hotplug.service
install -o root -g root -m 644 \
    "$REPO_DIR/scripts/systemd/printershare-hotplug.timer" \
    /etc/systemd/system/printershare-hotplug.timer
systemctl daemon-reload
systemctl enable --now printershare-hotplug.timer

# ── Scan retention purge ─────────────────────────────────────────────────
# Daily timer that deletes scan files older than SCANS_RETENTION_DAYS
# (default 14, configurable from the portal's Settings page).
info "Installing scan retention purge timer..."
install -o root -g root -m 755 \
    "$REPO_DIR/scripts/scan-purge.sh" \
    /usr/local/bin/printershare-scan-purge.sh
install -o root -g root -m 644 \
    "$REPO_DIR/scripts/systemd/printershare-scan-purge.service" \
    /etc/systemd/system/printershare-scan-purge.service
install -o root -g root -m 644 \
    "$REPO_DIR/scripts/systemd/printershare-scan-purge.timer" \
    /etc/systemd/system/printershare-scan-purge.timer
systemctl daemon-reload
systemctl enable --now printershare-scan-purge.timer

# ── Scheduled backups ─────────────────────────────────────────────────────
# Weekly config/state backup to /var/backups/printershare, pruned after 30
# days. scripts/restore.sh is installed alongside for recovery — untested
# backups aren't real backups, so it's a first-class part of this install,
# not an afterthought.
info "Installing scheduled backup timer..."
mkdir -p /var/backups/printershare
install -o root -g root -m 755 \
    "$REPO_DIR/scripts/backup.sh" \
    /usr/local/bin/printershare-backup.sh
install -o root -g root -m 755 \
    "$REPO_DIR/scripts/restore.sh" \
    /usr/local/bin/printershare-restore.sh
install -o root -g root -m 644 \
    "$REPO_DIR/scripts/systemd/printershare-backup.service" \
    /etc/systemd/system/printershare-backup.service
install -o root -g root -m 644 \
    "$REPO_DIR/scripts/systemd/printershare-backup.timer" \
    /etc/systemd/system/printershare-backup.timer
systemctl daemon-reload
systemctl enable --now printershare-backup.timer

# ── Log rotation + journal retention ─────────────────────────────────────
info "Configuring log rotation..."
install -o root -g root -m 644 \
    "$REPO_DIR/scripts/logrotate/printershare" \
    /etc/logrotate.d/printershare
mkdir -p /etc/systemd/journald.conf.d
install -o root -g root -m 644 \
    "$REPO_DIR/scripts/systemd/journald-printershare.conf" \
    /etc/systemd/journald.conf.d/printershare.conf
systemctl restart systemd-journald

info "Applying device quirks (per portal/server/data/device-quirks.json)"
QUIRK_PKGS="$("$REPO_DIR/scripts/apply-device-quirks.sh" || true)"
if [[ -n "$QUIRK_PKGS" ]]; then
    info "Installing device-specific packages: $(echo "$QUIRK_PKGS" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    apt-get install -y --no-install-recommends $QUIRK_PKGS || \
        warn "Some quirks packages failed to install — see apt log"
    # Re-run blacklist now that the preferred backends may be installed.
    "$REPO_DIR/scripts/apply-device-quirks.sh" >/dev/null || true
fi

# saned (network scanner) — bind on all interfaces; nginx fronts it.
grep -q '^0\.0\.0\.0/0' /etc/sane.d/saned.conf 2>/dev/null || \
    echo '0.0.0.0/0' >>/etc/sane.d/saned.conf

# ── Auto-add USB printer queue to CUPS ──────────────────────────────────────
# Discover any USB printer and register it with CUPS if not already present.
# Uses driverless / IPP-everywhere first; on failure, consults the quirks
# catalogue for a device-specific PPD hint (`print.ppd`, e.g. "suld:..."),
# resolves it under /usr/share/ppd/, and falls back to a fuzzy filename
# search keyed by the printer model in the USB URI.
info "Detecting USB printers"
sleep 2  # give cups time to enumerate after restart
PRINTER_URI="$(lpinfo -v 2>/dev/null | awk '/^direct usb:/{print $2; exit}')"
if [[ -n "$PRINTER_URI" ]] && ! lpstat -p 2>/dev/null | grep -q '^printer .* USB'; then
    PRINTER_NAME="$(echo "$PRINTER_URI" | sed -E 's|.*/([^?]+).*|\1|; s/[^A-Za-z0-9_-]/_/g')"
    info "Adding CUPS queue $PRINTER_NAME → $PRINTER_URI"
    # 1. Try driverless / IPP-everywhere — works for most modern devices.
    if ! lpadmin -p "$PRINTER_NAME" -E -v "$PRINTER_URI" -m everywhere 2>/dev/null; then
        PPD=""
        # 2. Quirks-catalogue lookup: take the first matched device's
        #    print.ppd hint and resolve it to a real file.
        if command -v jq >/dev/null && [[ -r "$REPO_DIR/portal/server/data/device-quirks.json" ]]; then
            QCAT="$REPO_DIR/portal/server/data/device-quirks.json"
            while read -r vid pid; do
                KEY="${vid,,}:${pid,,}"
                HINT="$(jq -r --arg k "$KEY" --arg v "${vid,,}:*" \
                    '.devices[$k].print.ppd // .devices[$v].print.ppd // empty' "$QCAT")"
                [[ -z "$HINT" ]] && continue
                # Hint formats:
                #   "suld:Samsung_SCX-3400_Series.ppd.gz"  → /usr/share/ppd/suld/<file>
                #   "/absolute/path/to/file.ppd"           → use as-is
                #   "everywhere" / "driverless"            → already tried above
                case "$HINT" in
                    /*)         [[ -r "$HINT" ]] && PPD="$HINT" ;;
                    everywhere|driverless) : ;;
                    *:*)
                        sub="${HINT%%:*}"
                        file="${HINT#*:}"
                        cand="/usr/share/ppd/$sub/$file"
                        [[ -r "$cand" ]] && PPD="$cand"
                        ;;
                esac
                [[ -n "$PPD" ]] && break
            done < <(lsusb | grep -oE 'ID [0-9a-fA-F]{4}:[0-9a-fA-F]{4}' | sed -E 's/^ID //; s/:/ /')
        fi
        # 3. Last-ditch: fuzzy search by model name embedded in the USB URI.
        if [[ -z "$PPD" ]]; then
            MODEL="$(echo "$PRINTER_URI" | sed -E 's|.*/||; s/[?].*//; s/%20/ /g')"
            PPD="$(find /usr/share/ppd /opt -iname "*${MODEL// /*}*.ppd*" 2>/dev/null | head -1)"
        fi
        if [[ -n "$PPD" ]]; then
            info "Using PPD: $PPD"
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
# scanservjs reads its local config from /usr/lib/scanservjs/config/config.local.js
# (relative to its server/ dir) — /etc/scanservjs/ is informational only.
# Templating: substitute OUTPUT_DIRECTORY constant in the shipped config
# so the JS file remains valid and editable in source control.
SCANSERVJS_LIB=/usr/lib/scanservjs/config
SCANSERVJS_ETC=/etc/scanservjs
mkdir -p "$SCANSERVJS_ETC" "$SCANSERVJS_LIB"
sed -E "s|^const OUTPUT_DIRECTORY = '[^']*';|const OUTPUT_DIRECTORY = '$SCANS_DIR';|" \
    "$REPO_DIR/scanservjs/config.js" >"$SCANSERVJS_LIB/config.local.js"
cp -f "$SCANSERVJS_LIB/config.local.js" "$SCANSERVJS_ETC/config.local.js"
# Allow the scanservjs system user to write into the scans directory.
chown -R scanservjs:users "$SCANS_DIR" 2>/dev/null || true
chmod 0777 "$SCANS_DIR"
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
# IMPORTANT: do NOT pass --interface=any. AirSane treats the value as a
# literal interface name, fails to look it up, returns SANE_STATUS_IO_ERROR,
# and segfaults during cleanup. Omitting --interface binds to all addresses
# (0.0.0.0 + ::), which is what we actually want.
ExecStart=/usr/local/bin/airsaned --listen-port=$AIRSANE_PORT --mdns-announce=true --web-interface=true --hotplug=true
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

# Persistent state + config dirs (referenced by the unit's Environment= lines).
mkdir -p /var/lib/printershare/portal-data /etc/printershare
[ -f /etc/printershare/portal.env ] || : >/etc/printershare/portal.env

# ── Auto-generate portal credentials on first install ───────────────────────
# Write each key only if it is not already present (idempotent on re-runs).
_env_set_default() {
    local key="$1" val="$2" file="/etc/printershare/portal.env"
    grep -q "^${key}=" "$file" || echo "${key}=${val}" >>"$file"
}
_env_set_default PORTAL_AUTH    "true"
_env_set_default PORTAL_USER    "admin"
_env_set_default PORTAL_PASS    "$(openssl rand -hex 12)"
_env_set_default PORTAL_SECRET  "$(openssl rand -hex 32)"
_env_set_default SCANS_RETENTION_DAYS "14"
_env_set_default LOG_LEVEL      "info"
# Cache the generated values so the summary can display them.
PORTAL_PASS_SHOW="$(grep '^PORTAL_PASS=' /etc/printershare/portal.env | cut -d= -f2-)"
PORTAL_USER_SHOW="$(grep '^PORTAL_USER=' /etc/printershare/portal.env | cut -d= -f2-)"

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
Environment=DEPLOYMENT_MODE=native
Environment=CUPS_LOCAL=1
Environment=CUPS_HOST=127.0.0.1
Environment=CUPS_PORT=631
Environment=SCANSERVJS_URL=http://127.0.0.1:$SCANSERVJS_PORT
Environment=SCANS_PATH=$SCANS_DIR
Environment=PORTAL_DATA_DIR=/var/lib/printershare/portal-data
Environment=DOTENV_PATH=/etc/printershare/portal.env
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

# ── Tailscale (optional remote access) ──────────────────────────────────────
# Install and enable tailscale if either:
#   a) TAILSCALE_AUTH_KEY is pre-set in the environment
#   b) The caller explicitly requests it via INSTALL_TAILSCALE=1
INSTALL_TAILSCALE="${INSTALL_TAILSCALE:-0}"
_ENVFILE=/etc/printershare/portal.env
_TS_KEY="${TAILSCALE_AUTH_KEY:-$(grep '^TAILSCALE_AUTH_KEY=' "$_ENVFILE" 2>/dev/null | cut -d= -f2-)}"
[[ -n "$_TS_KEY" ]] && INSTALL_TAILSCALE=1

if [[ "$INSTALL_TAILSCALE" == "1" ]] && ! command -v tailscale >/dev/null; then
    info "Installing Tailscale"
    # Source distro info
    . /etc/os-release
    _TS_CODENAME="${VERSION_CODENAME:-bookworm}"
    curl -fsSL "https://pkgs.tailscale.com/stable/${ID}/${_TS_CODENAME}.noarmor.gpg" \
        -o /usr/share/keyrings/tailscale-archive-keyring.gpg
    curl -fsSL "https://pkgs.tailscale.com/stable/${ID}/${_TS_CODENAME}.tailscale-keyring.list" \
        -o /etc/apt/sources.list.d/tailscale.list
    apt-get update -qq
    apt-get install -y --no-install-recommends tailscale
    systemctl enable --now tailscaled
    if [[ -n "$_TS_KEY" ]]; then
        tailscale up --authkey="$_TS_KEY" --accept-routes || warn "tailscale up failed — check key"
    fi
    # Store the key in the portal env if it came from the environment
    if [[ -n "${TAILSCALE_AUTH_KEY:-}" ]]; then
        grep -q '^TAILSCALE_AUTH_KEY=' "$_ENVFILE" 2>/dev/null || \
            echo "TAILSCALE_AUTH_KEY=${TAILSCALE_AUTH_KEY}" >> "$_ENVFILE"
    fi
elif command -v tailscale >/dev/null; then
    info "Tailscale already installed: $(tailscale version 2>/dev/null | head -1)"
fi

# ── Enable + (re)start the new units ────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now scanservjs.service
# AirSane (eSCL/AirScan bridge) gives macOS / iOS a native scanner via
# Bonjour. Earlier installs masked it because `--interface=any` made it
# crash on startup; with that fixed the service is stable on smfp.
systemctl unmask airsane.service 2>/dev/null || true
systemctl enable --now airsane.service
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
  Samba share : \\\\$ip\\Scans     (user: $SAMBA_USER / pass: $SAMBA_PASS)
  Portal login: user: $PORTAL_USER_SHOW   pass: $PORTAL_PASS_SHOW
               (auth ON — you will be prompted to set a new password on first login)

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
