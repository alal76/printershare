// Beta test version v1.2.0
'use strict';

const router = require('express').Router();
const { spawnSync } = require('node:child_process');
const fs   = require('node:fs');
const os   = require('node:os');
const { restartService, SERVICE_MAP, isNative } = require('../lib/deployment');

const ALLOWED_SERVICES = new Set(Object.keys(SERVICE_MAP));

// ── Optional component definitions ──────────────────────────────────────────
const COMPONENT_DEFS = {
  tailscale: {
    label: 'Tailscale VPN',
    description: 'Secure remote access from anywhere via Tailscale mesh VPN',
  },
  cloudflared: {
    label: 'Cloudflare Tunnel',
    description: 'Expose your portal via HTTPS without port forwarding',
  },
  rclone: {
    label: 'Rclone (Cloud Backup)',
    description: 'Sync scan files to Google Drive or OneDrive',
  },
};

function detectComponent(name) {
  const bins = { tailscale: 'tailscale', cloudflared: 'cloudflared', rclone: 'rclone' };
  const bin = bins[name];
  if (!bin) return false;
  const r = spawnSync('which', [bin], { encoding: 'utf8', timeout: 3_000 });
  return r.status === 0 && Boolean(r.stdout.trim());
}

// GET /api/v1/services/components
router.get('/components', (_req, res) => {
  const components = Object.entries(COMPONENT_DEFS).map(([name, def]) => ({
    name,
    label: def.label,
    description: def.description,
    installed: detectComponent(name),
  }));
  res.json({ components, native: isNative() });
});

// POST /api/v1/services/components/:name/install
router.post('/components/:name/install', (req, res) => {
  const { name } = req.params;
  if (!COMPONENT_DEFS[name]) {
    return res.status(400).json({ error: 'Unknown component' });
  }
  if (!isNative()) {
    return res.status(400).json({ error: 'Component install only available in native deployment mode' });
  }
  try {
    installComponent(name);
    res.json({ ok: true, installed: detectComponent(name) });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 500) });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function runCmd(cmd, args, timeout = 120_000) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || `${cmd} exited ${r.status}`).slice(0, 500));
  }
  return r.stdout.trim();
}

function getOsRelease() {
  let id = 'debian'; let codename = 'bookworm';
  try {
    const content = fs.readFileSync('/etc/os-release', 'utf8');
    const idM      = content.match(/^ID=["']?([^"'\s]+)["']?/m);
    const nameM    = content.match(/^VERSION_CODENAME=["']?([^"'\s]+)["']?/m);
    if (idM)   id       = idM[1];
    if (nameM) codename = nameM[1];
  } catch { /* use defaults */ }
  return { id, codename };
}

function installComponent(name) {
  switch (name) {
    case 'tailscale':   return installTailscale();
    case 'cloudflared': return installCloudflared();
    case 'rclone':      return installRclone();
    default: throw new Error(`No installer for ${name}`);
  }
}

/** Returns true when the process is running inside an LXC container. */
function isLxc() {
  try { return fs.readFileSync('/proc/1/environ', 'utf8').includes('container=lxc'); } catch { /* ignore */ }
  try { return fs.existsSync('/run/systemd/container'); } catch { /* ignore */ }
  return false;
}

function installTailscale() {
  const { id, codename } = getOsRelease();
  const gpgPath  = '/usr/share/keyrings/tailscale-archive-keyring.gpg';
  const listPath = '/etc/apt/sources.list.d/tailscale.list';
  runCmd('curl', ['-fsSL', `https://pkgs.tailscale.com/stable/${id}/${codename}.noarmor.gpg`, '-o', gpgPath], 30_000);
  runCmd('curl', ['-fsSL', `https://pkgs.tailscale.com/stable/${id}/${codename}.tailscale-keyring.list`, '-o', listPath], 30_000);
  runCmd('apt-get', ['update', '-qq'], 60_000);
  runCmd('apt-get', ['install', '-y', '--no-install-recommends', 'tailscale'], 300_000);
  // LXC containers lack /dev/net/tun; switch to userspace networking
  const needsUserspace = isLxc() || !fs.existsSync('/dev/net/tun');
  if (needsUserspace) {
    const overrideDir = '/etc/systemd/system/tailscaled.service.d';
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(`${overrideDir}/lxc-userspace.conf`,
      '[Service]\nExecStart=\nExecStart=/usr/sbin/tailscaled --tun=userspace-networking' +
      ' --state=/var/lib/tailscale/tailscaled.state' +
      ' --socket=/run/tailscale/tailscaled.sock --port=41641\n');
    runCmd('systemctl', ['daemon-reload'], 5_000);
  }
  runCmd('systemctl', ['enable', '--now', 'tailscaled'], 10_000);
  // Connect if auth key is already configured
  const dotenvPath = process.env.DOTENV_PATH || '/etc/printershare/portal.env';
  let authKey = '';
  try {
    const content = fs.readFileSync(dotenvPath, 'utf8');
    const m = content.match(/^TAILSCALE_AUTH_KEY=(.+)/m);
    if (m) authKey = m[1].trim().replaceAll(/^["']|["']$/g, '');
  } catch { /* no .env yet */ }
  if (authKey && !authKey.includes('\u2022')) {
    spawnSync('tailscale', ['up', `--authkey=${authKey}`, '--accept-routes'], {
      encoding: 'utf8', timeout: 30_000,
    });
  }
}

function archSuffix() {
  if (os.arch() === 'arm64') return 'arm64';
  return 'amd64';
}

function installCloudflared() {
  const arch = archSuffix();
  const url  = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
  runCmd('curl', ['-fsSL', url, '-o', '/usr/local/bin/cloudflared'], 60_000);
  runCmd('chmod', ['+x', '/usr/local/bin/cloudflared'], 3_000);
}

function installRclone() {
  try {
    runCmd('apt-get', ['install', '-y', '--no-install-recommends', 'rclone'], 120_000);
  } catch {
    const arch = archSuffix();
    const url  = `https://downloads.rclone.org/rclone-current-linux-${arch}.zip`;
    runCmd('curl', ['-fsSL', url, '-o', '/tmp/rclone.zip'], 60_000);
    runCmd('unzip', ['-qo', '/tmp/rclone.zip', '-d', '/tmp/rclone_x'], 30_000);
    const ls = spawnSync('bash', ['-c', 'ls /tmp/rclone_x/*/rclone 2>/dev/null | head -1'], { encoding: 'utf8', timeout: 3_000 });
    const bin = ls.stdout.trim();
    if (!bin) throw new Error('Could not locate rclone binary after extraction');
    runCmd('install', ['-m', '755', bin, '/usr/local/bin/rclone'], 3_000);
    spawnSync('rm', ['-rf', '/tmp/rclone.zip', '/tmp/rclone_x'], { encoding: 'utf8', timeout: 5_000 });
  }
}

// ── Service restart ──────────────────────────────────────────────────────────

// POST /api/v1/services/:name/restart
router.post('/:name/restart', (req, res) => {
  const { name } = req.params;
  if (!ALLOWED_SERVICES.has(name)) {
    return res.status(400).json({ error: 'Unknown service' });
  }
  const result = restartService(name);
  if (!result.ok) {
    return res.status(500).json({ error: result.message || 'Restart failed' });
  }
  res.json({ ok: true });
});

module.exports = router;
