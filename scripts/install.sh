#!/usr/bin/env bash
# Beta test version v1.2.0
# ═══════════════════════════════════════════════════════════════════════════
# install.sh — Bootstrap installer for PrinterShare (native/LXC only)
#
# Clones the repo from GitHub, configures system settings (SSH, timezone, locale,
# hostname, unattended-upgrades, UFW), and prepares for native or Proxmox LXC install.
#
# One-liner (as root):
#   curl -fsSL https://raw.githubusercontent.com/alal76/printershare/main/scripts/install.sh | sudo bash
#
# Non-interactive / CI mode (skip all prompts):
#   NONINTERACTIVE=1 bash install.sh
#
# Environment overrides:
#   REPO_URL=https://github.com/your-fork/printershare.git
#   BRANCH=main
#   INSTALL_DIR=/opt/printershare
#   TIMEZONE=Europe/London          (skip timezone prompt)
#   HOSTNAME_SET=printershare       (skip hostname prompt)
#   ENABLE_SSH=yes|no               (skip SSH prompt)
#   SSH_PORT=22                     (SSH port, default 22)
#   SSH_PERMIT_ROOT=yes|no          (PermitRootLogin, default yes)
#   SSH_PASSWORD_AUTH=yes|no        (PasswordAuthentication, default yes)
#   ENABLE_UFW=yes|no               (skip UFW prompt)
#   ENABLE_UNATTENDED=yes|no        (skip unattended-upgrades prompt)
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/alal76/printershare.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/printershare}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"

# ── Colour helpers (community-scripts style) ─────────────────────────────
RD='\e[1;31m'; GN='\e[1;32m'; YW='\e[1;33m'; BL='\e[1;34m'
BOLD='\e[1m'; CL='\e[0m'

msg_info()  { echo -e "${BL}${BOLD}  ⏳ $*${CL}"; }
msg_ok()    { echo -e "${GN}${BOLD}  ✓ $*${CL}"; }
msg_warn()  { echo -e "${YW}${BOLD}  ⚠ $*${CL}" >&2; }
msg_error() { echo -e "${RD}${BOLD}  ✗ $*${CL}" >&2; }
die()       { msg_error "$*"; exit 1; }
step()      { echo; echo -e "${BL}${BOLD}──────────────────────────────────────────${CL}"; msg_info "$*"; }

# ── Helper: ask yes/no (respects NONINTERACTIVE) ─────────────────────────
# Usage: ask_yn "Question?" default_answer  → sets $REPLY to "yes" or "no"
ask_yn() {
  local question="$1" default="${2:-no}"
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    REPLY="$default"
    return
  fi
  local prompt
  if [[ "$default" == "yes" ]]; then
    prompt="[Y/n]"
  else
    prompt="[y/N]"
  fi
  read -rp "  ${question} ${prompt} " answer </dev/tty || true
  answer="${answer:-$default}"
  case "${answer,,}" in
    y|yes) REPLY="yes" ;;
    *)     REPLY="no"  ;;
  esac
}

# ── Helper: prompt for value with default ────────────────────────────────
ask_value() {
  local question="$1" default="$2"
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    REPLY="$default"
    return
  fi
  read -rp "  ${question} [${default}]: " answer </dev/tty || true
  REPLY="${answer:-$default}"
}

[[ $EUID -ne 0 ]] && die "Run as root:  sudo bash $0"

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 0 — System settings (timezone, locale, hostname, SSH, UFW,
#            unattended-upgrades) — run before the app install so the
#            system is properly configured first.
# ═══════════════════════════════════════════════════════════════════════════

step "System configuration"

# ── 0a. Detect OS ─────────────────────────────────────────────────────────
[[ -f /etc/os-release ]] || die "/etc/os-release not found — only Ubuntu/Debian are supported."
# shellcheck source=/dev/null
source /etc/os-release
case "${ID:-}" in
  ubuntu|debian) msg_ok "OS: ${PRETTY_NAME}" ;;
  *) msg_warn "Untested OS '${ID:-unknown}' — proceeding anyway." ;;
esac

# ── 0b. Hostname ──────────────────────────────────────────────────────────
CURRENT_HOSTNAME="$(hostname 2>/dev/null || echo 'localhost')"
HOSTNAME_SET="${HOSTNAME_SET:-}"
if [[ -z "$HOSTNAME_SET" ]]; then
  ask_value "Set hostname" "printershare"
  HOSTNAME_SET="$REPLY"
fi
if [[ "$HOSTNAME_SET" != "$CURRENT_HOSTNAME" ]]; then
  msg_info "Setting hostname to ${HOSTNAME_SET}..."
  hostnamectl set-hostname "$HOSTNAME_SET" 2>/dev/null || \
    echo "$HOSTNAME_SET" > /etc/hostname
  # Update /etc/hosts so sudo doesn't warn about unknown hostname
  if grep -q "^127\.0\.1\.1" /etc/hosts 2>/dev/null; then
    sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t${HOSTNAME_SET}/" /etc/hosts
  else
    echo "127.0.1.1	${HOSTNAME_SET}" >> /etc/hosts
  fi
  msg_ok "Hostname: ${HOSTNAME_SET}"
fi

# ── 0c. Timezone ──────────────────────────────────────────────────────────
CURRENT_TZ="$(timedatectl show --value --property=Timezone 2>/dev/null || \
              cat /etc/timezone 2>/dev/null || echo 'UTC')"
TIMEZONE="${TIMEZONE:-}"
if [[ -z "$TIMEZONE" ]]; then
  ask_value "Set timezone (leave blank to keep '${CURRENT_TZ}')" "$CURRENT_TZ"
  TIMEZONE="$REPLY"
fi
if [[ -n "$TIMEZONE" && "$TIMEZONE" != "$CURRENT_TZ" ]]; then
  if [[ -f "/usr/share/zoneinfo/${TIMEZONE}" ]]; then
    msg_info "Setting timezone to ${TIMEZONE}..."
    timedatectl set-timezone "$TIMEZONE" 2>/dev/null || \
      ln -sf "/usr/share/zoneinfo/${TIMEZONE}" /etc/localtime
    echo "$TIMEZONE" > /etc/timezone
    msg_ok "Timezone: ${TIMEZONE}"
  else
    msg_warn "Unknown timezone '${TIMEZONE}' — keeping '${CURRENT_TZ}'"
  fi
fi

# ── 0d. Locale ────────────────────────────────────────────────────────────
_locales="$(locale -a 2>/dev/null || true)"
if ! grep -qi '^en_US\.utf-\?8$' <<<"$_locales"; then
  msg_info "Generating en_US.UTF-8 locale..."
  apt-get install -y --no-install-recommends locales -qq
  sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
  locale-gen en_US.UTF-8 >/dev/null
  update-locale LANG=en_US.UTF-8
  msg_ok "Locale: en_US.UTF-8"
fi
export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}"

# ── 0e. SSH ────────────────────────────────────────────────────────────────
ENABLE_SSH="${ENABLE_SSH:-}"
if [[ -z "$ENABLE_SSH" ]]; then
  ask_yn "Configure SSH server?" "yes"
  ENABLE_SSH="$REPLY"
fi

if [[ "$ENABLE_SSH" == "yes" ]]; then
  step "Configuring SSH..."
  apt-get install -y --no-install-recommends openssh-server -qq

  SSH_PORT="${SSH_PORT:-22}"
  SSH_PERMIT_ROOT="${SSH_PERMIT_ROOT:-}"
  SSH_PASSWORD_AUTH="${SSH_PASSWORD_AUTH:-}"

  if [[ -z "$SSH_PERMIT_ROOT" ]]; then
    ask_yn "Allow root SSH login?" "yes"
    SSH_PERMIT_ROOT="$REPLY"
  fi
  if [[ -z "$SSH_PASSWORD_AUTH" ]]; then
    ask_yn "Allow password authentication (disable for key-only)?" "yes"
    SSH_PASSWORD_AUTH="$REPLY"
  fi
  ask_value "SSH port" "$SSH_PORT"
  SSH_PORT="$REPLY"

  SSHD_CONF="/etc/ssh/sshd_config"
  # Apply settings idempotently with sed
  _sshd_set() {
    local key="$1" val="$2"
    if grep -qE "^#?${key}" "$SSHD_CONF"; then
      sed -i "s|^#*${key}.*|${key} ${val}|" "$SSHD_CONF"
    else
      echo "${key} ${val}" >> "$SSHD_CONF"
    fi
  }
  _sshd_set "Port"                   "$SSH_PORT"
  _sshd_set "PermitRootLogin"        "$([[ "$SSH_PERMIT_ROOT" == "yes" ]] && echo 'yes' || echo 'prohibit-password')"
  _sshd_set "PasswordAuthentication" "$([[ "$SSH_PASSWORD_AUTH" == "yes" ]] && echo 'yes' || echo 'no')"
  _sshd_set "X11Forwarding"          "no"
  _sshd_set "PrintMotd"              "no"
  _sshd_set "AcceptEnv"              "LANG LC_*"

  mkdir -p /root/.ssh && chmod 700 /root/.ssh

  systemctl enable --now ssh 2>/dev/null || systemctl enable --now openssh-server 2>/dev/null || true
  systemctl reload-or-restart ssh 2>/dev/null || systemctl reload-or-restart openssh-server 2>/dev/null || true
  msg_ok "SSH configured (port ${SSH_PORT}, root login: ${SSH_PERMIT_ROOT}, password auth: ${SSH_PASSWORD_AUTH})"
fi

# ── 0f. Unattended upgrades ────────────────────────────────────────────────
ENABLE_UNATTENDED="${ENABLE_UNATTENDED:-}"
if [[ -z "$ENABLE_UNATTENDED" ]]; then
  ask_yn "Enable automatic security updates (unattended-upgrades)?" "yes"
  ENABLE_UNATTENDED="$REPLY"
fi
if [[ "$ENABLE_UNATTENDED" == "yes" ]]; then
  msg_info "Enabling unattended-upgrades..."
  apt-get install -y --no-install-recommends unattended-upgrades apt-listchanges -qq
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT_EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT_EOF
  systemctl enable --now unattended-upgrades 2>/dev/null || true
  msg_ok "Unattended-upgrades enabled"
fi

# ── 0g. UFW firewall ──────────────────────────────────────────────────────
ENABLE_UFW="${ENABLE_UFW:-}"
if [[ -z "$ENABLE_UFW" ]]; then
  ask_yn "Configure UFW firewall?" "no"
  ENABLE_UFW="$REPLY"
fi
if [[ "$ENABLE_UFW" == "yes" ]]; then
  msg_info "Configuring UFW firewall..."
  apt-get install -y --no-install-recommends ufw -qq
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow "${SSH_PORT:-22}/tcp"   comment "SSH"
  ufw allow 80/tcp                  comment "PrinterShare HTTP"
  ufw allow 443/tcp                 comment "PrinterShare HTTPS"
  ufw allow 631/tcp                 comment "CUPS"
  ufw allow 5353/udp                comment "mDNS/Bonjour"
  ufw allow 2049/tcp                comment "NFS (optional)"
  ufw allow 445/tcp                 comment "Samba (optional)"
  ufw --force enable
  msg_ok "UFW firewall enabled"
fi

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 1 — Application install
# ═══════════════════════════════════════════════════════════════════════════

# ── 1. Install system dependencies ───────────────────────────────────────
step "Installing system dependencies..."
apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release git

## ── 2. (Removed: Docker install) ───────────────────────────────────────

# ── 2. Clone / update repository ─────────────────────────────────────────
step "Setting up repository at ${INSTALL_DIR}..."
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  msg_info "Updating existing install..."
  git -C "${INSTALL_DIR}" fetch --quiet origin
  git -C "${INSTALL_DIR}" checkout "${BRANCH}"
  git -C "${INSTALL_DIR}" pull --ff-only origin "${BRANCH}"
else
  msg_info "Cloning from ${REPO_URL} (branch: ${BRANCH})..."
  git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
fi
cd "${INSTALL_DIR}"
msg_ok "Code at: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

docker compose --env-file .env build
docker compose --env-file .env up -d --remove-orphans
echo
echo

# ── 3. Set up .env ────────────────────────────────────────────────────────
step "Configuring environment..."
if [[ ! -f .env ]]; then
  cp .env.example .env
  msg_ok "Created .env from template. Edit ${INSTALL_DIR}/.env if needed, or use the web wizard."
else
  msg_ok ".env already exists — skipping template copy."
fi

# ── 4. Create scan output directory ──────────────────────────────────────
SCANS_PATH="$(grep -E '^SCANS_HOST_PATH=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'" || true)"
SCANS_PATH="${SCANS_PATH:-/srv/printershare/scans}"
mkdir -p "${SCANS_PATH}" && chmod 777 "${SCANS_PATH}"
msg_ok "Scan output directory: ${SCANS_PATH}"

echo
msg_ok "PrinterShare repository is ready at ${INSTALL_DIR}."
msg_ok "To complete installation:"
msg_ok "  - For bare-metal Linux:   sudo bash scripts/install-native.sh"
msg_ok "  - For Proxmox LXC:        sudo bash scripts/proxmox/install.sh"
msg_ok "After install, use:        sudo bash scripts/deploy.sh  (to update/restart)"

# ═══════════════════════════════════════════════════════════════════════════
# update_script() — called when re-running on an existing install
# (mirrors the community-scripts/ProxmoxVE pattern used in update_script())
# ═══════════════════════════════════════════════════════════════════════════
update_script() {
  step "Updating PrinterShare..."

  [[ -d "${INSTALL_DIR}/.git" ]] || die "${INSTALL_DIR} is not a git repository."

  msg_info "Pulling latest code..."
  git -C "${INSTALL_DIR}" fetch --quiet origin
  git -C "${INSTALL_DIR}" pull --ff-only origin "${BRANCH}"
  msg_ok "Code updated: $(git -C "${INSTALL_DIR}" rev-parse --short HEAD)"

  msg_info "Rebuilding images..."
  cd "${INSTALL_DIR}"
  docker compose --env-file .env build

  msg_info "Restarting services..."
  docker compose --env-file .env up -d --remove-orphans

  msg_ok "PrinterShare updated and running."
}
