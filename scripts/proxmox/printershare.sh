#!/usr/bin/env bash
# Beta test version v1.2.0
# ============================================================================
#  printershare.sh — Proxmox VE helper (community-scripts/ProxmoxVE style)
# ----------------------------------------------------------------------------
#  Builds a Debian 12 LXC pre-configured for USB printer/scanner sharing
#  and runs the in-LXC installer.  Idempotent: re-running on an existing CT
#  rewrites the passthrough config and re-applies the in-LXC installer.
#
#    Run on the PVE host (always pulls the latest from main):
#      bash -c "$(curl -fsSL https://raw.githubusercontent.com/alal76/printershare/main/scripts/proxmox/printershare.sh)"
#
#    Update an existing CT (re-run installer + refresh passthrough):
#      bash -c "$(curl -fsSL https://raw.githubusercontent.com/alal76/printershare/main/scripts/proxmox/printershare.sh)" -- --update 105
#
#    From a local clone (skip self-update — for development only):
#      LOCAL=1 bash scripts/proxmox/printershare.sh
# ============================================================================
set -euo pipefail

SCRIPT_VERSION="2"
SENTINEL_BEGIN="# >>> printershare-passthrough >>>"
SENTINEL_END="# <<< printershare-passthrough <<<"
REPO_URL_DEFAULT="https://github.com/alal76/printershare.git"
REPO_BRANCH_DEFAULT="main"
RAW_BASE_DEFAULT="https://raw.githubusercontent.com/alal76/printershare/main"

# ── Style ────────────────────────────────────────────────────────────────────
RD='\e[1;31m'; GN='\e[1;32m'; YW='\e[1;33m'; BL='\e[1;34m'; CL='\e[0m'
msg_info() { echo -e "${BL}==>${CL} $*"; }
msg_ok()   { echo -e "${GN} ✓${CL} $*"; }
msg_warn() { echo -e "${YW}WARN:${CL} $*"; }
msg_err()  { echo -e "${RD}ERROR:${CL} $*" >&2; }
die()      { msg_err "$*"; exit 1; }

banner() {
cat <<EOF
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║          P R I N T E R S H A R E   ·   L X C   v$SCRIPT_VERSION              ║
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

# ── Local-clone freshness check ──────────────────────────────────────────────
# Only triggers when LOCAL=1 (i.e. the user is running from a local checkout).
# Curl-piped invocations always use the latest main, so they're fine by definition.
if [[ "${LOCAL:-0}" == "1" ]]; then
    repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd || true)"
    if [[ -n "$repo_dir" && -d "$repo_dir/.git" ]]; then
        if git -C "$repo_dir" fetch --quiet origin "$REPO_BRANCH_DEFAULT" 2>/dev/null; then
            local_sha="$(git -C "$repo_dir" rev-parse HEAD 2>/dev/null || true)"
            remote_sha="$(git -C "$repo_dir" rev-parse "origin/$REPO_BRANCH_DEFAULT" 2>/dev/null || true)"
            if [[ -n "$remote_sha" && "$local_sha" != "$remote_sha" ]]; then
                msg_warn "Local clone is behind origin/$REPO_BRANCH_DEFAULT"
                msg_warn "  local : $local_sha"
                msg_warn "  remote: $remote_sha"
                msg_warn "Run: git -C $repo_dir pull --ff-only"
                read -rp "  Continue anyway? [y/N] " yn
                [[ "${yn:-N}" =~ ^[Yy] ]] || exit 1
            fi
        fi
    fi
fi

# ── CLI args ─────────────────────────────────────────────────────────────────
ACTION="create"
ARG_CTID=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --update|-u)  ACTION="update"; ARG_CTID="${2:-}"; shift 2 ;;
        --create|-c)  ACTION="create"; shift ;;
        --help|-h)
            sed -n '1,20p' "$0" 2>/dev/null | sed 's/^#\s\?//' || true
            exit 0
            ;;
        *)            die "Unknown arg: $1 (try --help)" ;;
    esac
done

banner
msg_info "Mode: $ACTION"

# ── Defaults ─────────────────────────────────────────────────────────────────
HOSTNAME_DEFAULT="printershare"
DISK_GB_DEFAULT="8"
RAM_MB_DEFAULT="2048"
SWAP_MB_DEFAULT="512"
CORES_DEFAULT="2"
BRIDGE_DEFAULT="vmbr0"
STORAGE_DEFAULT="local-lvm"
TEMPLATE_STORAGE_DEFAULT="local"

# ── Helpers ──────────────────────────────────────────────────────────────────

# Write the passthrough block, replacing any existing sentinel-marked block
# AND scrubbing legacy lines that may have been hand-edited or written by
# earlier versions of this script.
apply_passthrough() {
    local conf="$1"
    [[ -f "$conf" ]] || die "$conf not found"

    # 1) Strip the existing sentinel block (if any).  Safe even if absent.
    sed -i "\|^${SENTINEL_BEGIN}$|,\|^${SENTINEL_END}$|d" "$conf"

    # 2) Scrub legacy / conflicting individual lines.  Only match the keys
    #    this script manages — never touch user-set keys.
    sed -i \
        -e '/^lxc\.cap\.keep[[:space:]]*[:=]/d' \
        -e '/^lxc\.apparmor\.profile[[:space:]]*[:=]/d' \
        -e '/^lxc\.cgroup2\.devices\.allow[[:space:]]*[:=][[:space:]]*c[[:space:]]*189:/d' \
        -e '/^lxc\.cgroup2\.devices\.allow[[:space:]]*[:=][[:space:]]*c[[:space:]]*180:/d' \
        -e '/^lxc\.mount\.entry[[:space:]]*[:=][[:space:]]*\/dev\/bus\/usb/d' \
        -e '/^lxc\.mount\.entry[[:space:]]*[:=][[:space:]]*\/sys\/bus\/usb/d' \
        -e '/^# ── printershare:.*passthrough/d' \
        "$conf"

    # 3) Trim trailing blank lines.
    while [[ -s "$conf" && -z "$(tail -1 "$conf")" ]]; do
        sed -i '$d' "$conf"
    done

    # 4) Append the canonical block (sentinels included).
    cat >>"$conf" <<EOF

$SENTINEL_BEGIN
# Managed by printershare.sh v$SCRIPT_VERSION — DO NOT EDIT THIS BLOCK BY HAND.
# Re-running scripts/proxmox/printershare.sh rewrites it.
#
# Allow read/write/mknod on USB bus (189:*) and hidraw (180:*) char devices.
lxc.cgroup2.devices.allow: c 189:* rwm
lxc.cgroup2.devices.allow: c 180:* rwm
# Bind-mount usbfs and sysfs/usb so hot-plugged devices appear live and
# SANE backends can do unbind/bind resets when needed.
lxc.mount.entry: /dev/bus/usb dev/bus/usb none bind,create=dir,optional 0 0
lxc.mount.entry: /sys/bus/usb sys/bus/usb none bind,create=dir,optional 0 0
# AppArmor profile — unconfined is required for usbfs ioctls.
lxc.apparmor.profile: unconfined
$SENTINEL_END
EOF
}

# Verify the config parses before starting the CT.
verify_lxc_config() {
    local ctid="$1"
    if ! pct config "$ctid" >/dev/null 2>&1; then
        msg_err "pct config $ctid failed:"
        pct config "$ctid" 2>&1 | head -10 | sed 's/^/    /'
        die "config rejected by pct"
    fi
    # `lxc-info -p` only works on running CTs (returns "doesn't exist" for
    # stopped ones), so we don't use it here.  pct start will surface any
    # remaining config errors with a clear message of its own.
}

# Run the in-CT installer.  We bootstrap git inside the CT and `git clone`
# the repo to /opt/printershare, then run install.sh from the working tree.
# This avoids relying on raw.githubusercontent.com (whose CDN can serve
# stale install.sh for several minutes after a push).
run_in_ct_installer() {
    local ctid="$1" repo_url="$2" repo_branch="$3"

    msg_info "Bootstrapping CT $ctid (apt update, install curl/git)"
    pct exec "$ctid" -- bash -c '
        set -e
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y --no-install-recommends curl ca-certificates git >/dev/null
    '

    msg_info "Cloning $repo_url ($repo_branch) into CT $ctid:/opt/printershare"
    pct exec "$ctid" -- bash -c "
        set -e
        if [[ ! -d /opt/printershare/.git ]]; then
            rm -rf /opt/printershare
            git clone --depth 1 --branch '$repo_branch' '$repo_url' /opt/printershare
        else
            git -C /opt/printershare fetch --depth 1 origin '$repo_branch'
            git -C /opt/printershare reset --hard 'origin/$repo_branch'
        fi
    " || die "git clone failed inside CT $ctid"

    msg_info "Running /opt/printershare/scripts/proxmox/install.sh inside CT $ctid"
    pct exec "$ctid" -- bash -c "
        set -e
        export REPO_URL='$repo_url'
        export REPO_BRANCH='$repo_branch'
        bash /opt/printershare/scripts/proxmox/install.sh
    " || die "in-LXC install failed — see CT $ctid console (pct enter $ctid)"
}

print_summary() {
    local ctid="$1" host="$2"
    local ip
    ip="$(pct exec "$ctid" -- hostname -I 2>/dev/null | awk '{print $1}')"
    [[ -z "$ip" ]] && ip="(check: pct exec $ctid -- hostname -I)"
    cat <<EOF

  ┌──────────────────────────────────────────────────────────────┐
  │  CT ID    : $ctid
  │  Hostname : $host
  │  IP       : $ip
  │  Portal   : http://$ip/
  │  CUPS     : http://$ip:631/
  │  Samba    : \\\\$ip\\Scans
  └──────────────────────────────────────────────────────────────┘

  Logs:    pct exec $ctid -- journalctl -u printershare-portal -f
  Update:  bash -c "\$(curl -fsSL ${RAW_BASE_DEFAULT}/scripts/proxmox/printershare.sh)" -- --update $ctid

EOF
}

# ────────────────────────────────────────────────────────────────────────────
#  ACTION: update — re-run on an existing CT
# ────────────────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "update" ]]; then
    [[ -n "$ARG_CTID" ]] || die "--update requires a CTID, e.g.  --update 105"
    [[ "$ARG_CTID" =~ ^[0-9]+$ ]] || die "CTID must be numeric"
    pct status "$ARG_CTID" &>/dev/null || die "CT $ARG_CTID does not exist"

    HOST="$(pct config "$ARG_CTID" 2>/dev/null | awk -F': ' '/^hostname:/ {print $2}')"
    HOST="${HOST:-$HOSTNAME_DEFAULT}"

    msg_info "Refreshing passthrough config for CT $ARG_CTID ($HOST)"
    apply_passthrough "/etc/pve/lxc/${ARG_CTID}.conf"
    verify_lxc_config "$ARG_CTID"
    msg_ok "Config OK"

    if pct status "$ARG_CTID" 2>/dev/null | grep -q running; then
        msg_info "Restarting CT $ARG_CTID to pick up config changes"
        pct reboot "$ARG_CTID" 2>/dev/null || { pct stop "$ARG_CTID" || true; pct start "$ARG_CTID"; }
    else
        msg_info "Starting CT $ARG_CTID"
        pct start "$ARG_CTID"
    fi

    # Wait for network.
    for _ in {1..30}; do
        pct exec "$ARG_CTID" -- sh -c 'ip -4 addr show dev eth0 | grep -q "inet "' 2>/dev/null && break
        sleep 1
    done

    run_in_ct_installer "$ARG_CTID" "$REPO_URL_DEFAULT" "$REPO_BRANCH_DEFAULT"
    msg_ok "CT $ARG_CTID updated"
    print_summary "$ARG_CTID" "$HOST"
    exit 0
fi

# ────────────────────────────────────────────────────────────────────────────
#  ACTION: create — interactive prompt + new CT
# ────────────────────────────────────────────────────────────────────────────
CTID_DEFAULT="$(pvesh get /cluster/nextid)"

echo
echo "  [1] Default settings    (hostname=$HOSTNAME_DEFAULT, ${CORES_DEFAULT} cores, ${RAM_MB_DEFAULT}MB RAM, ${DISK_GB_DEFAULT}GB disk)"
echo "  [2] Advanced settings   (customize hostname / resources / network)"
echo
read -rp "  Select [1]: " MODE
MODE="${MODE:-1}"

ask() {
    local prompt="$1" def="$2" v
    read -rp "    $prompt [$def]: " v
    echo "${v:-$def}"
}

# Prompt for a password twice (silently). Empty input keeps no-password
# default (use `pct enter <ctid>` from the PVE host to access the CT).
ask_password() {
    local p1 p2
    while true; do
        read -rsp "    Root password (blank = no password, use 'pct enter $CTID' from PVE): " p1
        echo
        if [[ -z "$p1" ]]; then
            ROOT_PASSWORD=""
            return
        fi
        read -rsp "    Confirm root password: " p2
        echo
        if [[ "$p1" == "$p2" ]]; then
            ROOT_PASSWORD="$p1"
            return
        fi
        msg_warn "Passwords didn't match, try again."
    done
}

ROOT_PASSWORD=""

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
    ask_password
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
    ask_password
fi

# ── Sanity ───────────────────────────────────────────────────────────────────
[[ "$CTID" =~ ^[0-9]+$ ]] || die "CTID must be numeric"
if pct status "$CTID" &>/dev/null; then
    msg_warn "CT $CTID already exists."
    msg_warn "  To update it in place, re-run with: --update $CTID"
    msg_warn "  To recreate, first run: pct stop $CTID; pct destroy $CTID"
    exit 1
fi
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
PCT_CREATE_ARGS=(
    --hostname        "$HOST"
    --cores           "$CORES"
    --memory          "$RAM_MB"
    --swap            "$SWAP_MB"
    --rootfs          "${STORAGE}:${DISK_GB}"
    --net0            "name=eth0,bridge=${BRIDGE},ip=dhcp,ip6=auto"
    --features        "nesting=1,keyctl=1"
    --unprivileged    0
    --onboot          1
    --start           0
)
if [[ -n "$ROOT_PASSWORD" ]]; then
    PCT_CREATE_ARGS+=( --password "$ROOT_PASSWORD" )
fi
pct create "$CTID" "$TEMPLATE_REF" "${PCT_CREATE_ARGS[@]}"
msg_ok "CT $CTID created"

# ── Apply passthrough block ─────────────────────────────────────────────────
msg_info "Writing USB + sysfs passthrough to /etc/pve/lxc/${CTID}.conf"
apply_passthrough "/etc/pve/lxc/${CTID}.conf"
verify_lxc_config "$CTID"
msg_ok "Passthrough configured + config verified"

# ── Boot ─────────────────────────────────────────────────────────────────────
msg_info "Starting CT $CTID"
pct start "$CTID"

msg_info "Waiting for network in CT $CTID"
for _ in {1..30}; do
    pct exec "$CTID" -- sh -c 'ip -4 addr show dev eth0 | grep -q "inet "' 2>/dev/null && break
    sleep 1
done
msg_ok "CT $CTID up"

# ── In-CT installer ──────────────────────────────────────────────────────────
run_in_ct_installer "$CTID" "$REPO_URL" "$REPO_BRANCH"

# ── Done ─────────────────────────────────────────────────────────────────────
echo
msg_ok "printershare LXC ready"
print_summary "$CTID" "$HOST"
