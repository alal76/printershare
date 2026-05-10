#!/usr/bin/env bash
# ============================================================================
#  printershare.sh — Proxmox VE helper (community-scripts/ProxmoxVE style)
# ----------------------------------------------------------------------------
#  Builds a Debian 12 LXC pre-configured for USB printer/scanner sharing
#  and runs the in-LXC installer.
#
#    Run on the PVE host:
#       bash -c "$(curl -fsSL https://raw.githubusercontent.com/alal76/printershare/main/scripts/proxmox/printershare.sh)"
#
#    Or, from a local clone on the PVE host:
#       bash scripts/proxmox/printershare.sh
#
#  What it does:
#    1. Downloads the latest debian-12-standard LXC template.
#    2. Creates a privileged container with nesting + USB cgroup access.
#    3. Bind-mounts /dev/bus/usb and /sys/bus/usb so SANE/CUPS see hot-plugs.
#    4. Boots the CT, installs printershare via scripts/proxmox/install.sh.
#
#  Settings: pick "Default" (recommended) or "Advanced" at the prompt.
# ============================================================================
set -euo pipefail

# ── Style ────────────────────────────────────────────────────────────────────
RD='\e[1;31m'; GN='\e[1;32m'; YW='\e[1;33m'; BL='\e[1;34m'; CY='\e[1;36m'; CL='\e[0m'
msg_info() { echo -e "${BL}==>${CL} $*"; }
msg_ok()   { echo -e "${GN} ✓${CL} $*"; }
msg_warn() { echo -e "${YW}WARN:${CL} $*"; }
msg_err()  { echo -e "${RD}ERROR:${CL} $*" >&2; }
die()      { msg_err "$*"; exit 1; }

banner() {
cat <<'EOF'
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║          P R I N T E R S H A R E   ·   L X C                 ║
  ║                                                              ║
  ║       Proxmox VE helper · Debian 12 · privileged             ║
  ║                                                              ║
  ╚══════════════════════════════════════════════════════════════╝
EOF
}

# ── Pre-flight ───────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Must run as root on the Proxmox VE host."
command -v pct           >/dev/null || die "pct not found — run on a PVE node."
command -v pveam         >/dev/null || die "pveam not found — run on a PVE node."
command -v pvesm         >/dev/null || die "pvesm not found — run on a PVE node."

banner

# ── Defaults ─────────────────────────────────────────────────────────────────
HOSTNAME_DEFAULT="printershare"
CTID_DEFAULT="$(pvesh get /cluster/nextid)"
DISK_GB_DEFAULT="8"
RAM_MB_DEFAULT="2048"
SWAP_MB_DEFAULT="512"
CORES_DEFAULT="2"
BRIDGE_DEFAULT="vmbr0"
STORAGE_DEFAULT="local-lvm"
TEMPLATE_STORAGE_DEFAULT="local"
REPO_URL_DEFAULT="https://github.com/alal76/printershare.git"
REPO_BRANCH_DEFAULT="main"

# ── Mode prompt ──────────────────────────────────────────────────────────────
echo
echo "  [1] Default settings    (hostname=$HOSTNAME_DEFAULT, ${CORES_DEFAULT} cores, ${RAM_MB_DEFAULT}MB RAM, ${DISK_GB_DEFAULT}GB disk)"
echo "  [2] Advanced settings   (customize hostname / resources / network)"
echo
read -rp "  Select [1]: " MODE
MODE="${MODE:-1}"

ask() {  # ask "Prompt" "default" → echoes value
    local prompt="$1" def="$2" v
    read -rp "    $prompt [$def]: " v
    echo "${v:-$def}"
}

if [[ "$MODE" == "2" ]]; then
    echo
    msg_info "Advanced settings"
    CTID=$(ask "Container ID"            "$CTID_DEFAULT")
    HOST=$(ask "Hostname"                "$HOSTNAME_DEFAULT")
    DISK_GB=$(ask "Disk size (GB)"       "$DISK_GB_DEFAULT")
    RAM_MB=$(ask "Memory (MB)"           "$RAM_MB_DEFAULT")
    SWAP_MB=$(ask "Swap (MB)"            "$SWAP_MB_DEFAULT")
    CORES=$(ask "CPU cores"              "$CORES_DEFAULT")
    BRIDGE=$(ask "Network bridge"        "$BRIDGE_DEFAULT")
    STORAGE=$(ask "Root-disk storage"    "$STORAGE_DEFAULT")
    TEMPLATE_STORAGE=$(ask "Template storage" "$TEMPLATE_STORAGE_DEFAULT")
    REPO_URL=$(ask "Git repo URL"        "$REPO_URL_DEFAULT")
    REPO_BRANCH=$(ask "Git branch"       "$REPO_BRANCH_DEFAULT")
else
    CTID="$CTID_DEFAULT"
    HOST="$HOSTNAME_DEFAULT"
    DISK_GB="$DISK_GB_DEFAULT"
    RAM_MB="$RAM_MB_DEFAULT"
    SWAP_MB="$SWAP_MB_DEFAULT"
    CORES="$CORES_DEFAULT"
    BRIDGE="$BRIDGE_DEFAULT"
    STORAGE="$STORAGE_DEFAULT"
    TEMPLATE_STORAGE="$TEMPLATE_STORAGE_DEFAULT"
    REPO_URL="$REPO_URL_DEFAULT"
    REPO_BRANCH="$REPO_BRANCH_DEFAULT"
fi

# ── Sanity ───────────────────────────────────────────────────────────────────
[[ "$CTID" =~ ^[0-9]+$ ]] || die "CTID must be numeric"
pct status "$CTID" &>/dev/null && die "CTID $CTID already exists. Pick another or destroy it first (pct destroy $CTID)."
pvesm status -storage "$STORAGE"          &>/dev/null || die "Storage '$STORAGE' not found"
pvesm status -storage "$TEMPLATE_STORAGE" &>/dev/null || die "Template storage '$TEMPLATE_STORAGE' not found"

# ── Template ─────────────────────────────────────────────────────────────────
msg_info "Selecting Debian 12 template"
pveam update >/dev/null 2>&1 || true
TEMPLATE="$(pveam available -section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)"
[[ -z "$TEMPLATE" ]] && die "No debian-12-standard template available. Run: pveam update"

if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
    msg_info "Downloading $TEMPLATE to $TEMPLATE_STORAGE"
    pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi
TEMPLATE_REF="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
msg_ok "Template: $TEMPLATE_REF"

# ── Create container ─────────────────────────────────────────────────────────
msg_info "Creating CT $CTID ($HOST) — ${CORES}c / ${RAM_MB}MB / ${DISK_GB}GB / $BRIDGE"
pct create "$CTID" "$TEMPLATE_REF" \
    --hostname        "$HOST" \
    --cores           "$CORES" \
    --memory          "$RAM_MB" \
    --swap            "$SWAP_MB" \
    --rootfs          "${STORAGE}:${DISK_GB}" \
    --net0            "name=eth0,bridge=${BRIDGE},ip=dhcp,ip6=auto" \
    --features        "nesting=1,keyctl=1" \
    --unprivileged    0 \
    --onboot          1 \
    --start           0
msg_ok "CT $CTID created"

# ── USB + sysfs passthrough ──────────────────────────────────────────────────
CONF="/etc/pve/lxc/${CTID}.conf"
msg_info "Adding USB + sysfs passthrough to $CONF"
cat >>"$CONF" <<'CONF'

# ── printershare: USB printer / scanner passthrough ───────────────
# Allow read/write/mknod on USB bus and hidraw character devices.
lxc.cgroup2.devices.allow: c 189:* rwm
lxc.cgroup2.devices.allow: c 180:* rwm
# Bind-mount the entire usbfs tree so hot-plugged devices appear live.
lxc.mount.entry: /dev/bus/usb dev/bus/usb none bind,create=dir,optional 0 0
# /sys/bus/usb gives SANE backends the option to do unbind/bind resets
# (helps with flaky multifunction devices like Samsung SCX-3400).
lxc.mount.entry: /sys/bus/usb sys/bus/usb none bind,create=dir,optional 0 0
# Privileged containers already keep CAP_SYS_ADMIN by default — no
# `lxc.cap.keep` line needed (and it would conflict with PVE's default
# `lxc.cap.drop`).  USBDEVFS_RESET ioctls work out of the box.
# AppArmor profile — unconfined is required for usbfs ioctls.
lxc.apparmor.profile: unconfined
CONF
msg_ok "Passthrough configured"

# ── Boot ─────────────────────────────────────────────────────────────────────
msg_info "Starting CT $CTID"
pct start "$CTID"

# Wait until the CT has DHCP / network.
msg_info "Waiting for network in CT $CTID"
for i in {1..30}; do
    if pct exec "$CTID" -- sh -c 'ip -4 addr show dev eth0 | grep -q "inet "' 2>/dev/null; then
        break
    fi
    sleep 1
done
CT_IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
[[ -z "$CT_IP" ]] && msg_warn "CT $CTID has no IP yet — install will still try"
msg_ok "CT $CTID ready at ${CT_IP:-<no-ip>}"

# ── Run the in-CT installer ──────────────────────────────────────────────────
msg_info "Running in-LXC installer (this takes a few minutes)"
pct exec "$CTID" -- bash -c '
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y --no-install-recommends curl ca-certificates git >/dev/null
'
INSTALL_URL="https://raw.githubusercontent.com/${REPO_URL#https://github.com/}"
INSTALL_URL="${INSTALL_URL%.git}/${REPO_BRANCH}/scripts/proxmox/install.sh"

pct exec "$CTID" -- bash -c "
    export REPO_URL='$REPO_URL'
    export REPO_BRANCH='$REPO_BRANCH'
    curl -fsSL '$INSTALL_URL' | bash
" || die "in-LXC install failed — see CT $CTID console (pct enter $CTID)"

# ── Done ─────────────────────────────────────────────────────────────────────
echo
msg_ok "printershare LXC ready"
cat <<EOF

  ┌──────────────────────────────────────────────────────────────┐
  │  CT ID    : $CTID
  │  Hostname : $HOST
  │  IP       : ${CT_IP:-(check pct exec $CTID -- hostname -I)}
  │  Portal   : http://${CT_IP:-CT_IP}/
  │  CUPS     : http://${CT_IP:-CT_IP}:631/
  │  Samba    : \\\\${CT_IP:-CT_IP}\\Scans
  └──────────────────────────────────────────────────────────────┘

  Plug your USB printer into the Proxmox host. The CT picks it up
  automatically via the /dev/bus/usb bind-mount.

  Manage the services:
    pct enter $CTID
    systemctl status printershare-portal scanservjs cups

EOF
