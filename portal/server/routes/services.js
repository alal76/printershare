// Beta test version v1.2.0
'use strict';

const router = require('express').Router();
const { spawn, spawnSync } = require('node:child_process');
const fs   = require('node:fs');
const os   = require('node:os');
const { startService, stopService, restartService, SERVICE_MAP, isNative } = require('../lib/deployment');
const { DOTENV_PATH } = require('../lib/env');

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
router.post('/components/:name/install', async (req, res) => {
  const { name } = req.params;
  if (!COMPONENT_DEFS[name]) {
    return res.status(400).json({ error: 'Unknown component' });
  }
  if (!isNative()) {
    return res.status(400).json({ error: 'Component install only available in native deployment mode' });
  }
  try {
    await installComponent(name);
    res.json({ ok: true, installed: detectComponent(name) });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 500) });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Async equivalent of a strict spawnSync: resolves with trimmed stdout,
 * rejects on nonzero exit. Component installs (apt-get update/install,
 * curl downloads) can run for minutes — spawnSync would block the entire
 * Node event loop, freezing every other in-flight request on the portal
 * for that whole duration.
 */
function runCmd(cmd, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      timeout,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString('utf8'); });
    child.stderr.on('data', d => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0) {
        const detail = stderr || stdout || (signal ? `${cmd} terminated by signal ${signal}` : `${cmd} exited ${code}`);
        reject(new Error(detail.slice(0, 500)));
        return;
      }
      resolve(stdout.trim());
    });
  });
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
    default: return Promise.reject(new Error(`No installer for ${name}`));
  }
}

/** Returns true when the process is running inside an LXC container. */
function isLxc() {
  try { return fs.readFileSync('/proc/1/environ', 'utf8').includes('container=lxc'); } catch { /* ignore */ }
  try { return fs.existsSync('/run/systemd/container'); } catch { /* ignore */ }
  return false;
}

async function installTailscale() {
  const { id, codename } = getOsRelease();
  const gpgPath  = '/usr/share/keyrings/tailscale-archive-keyring.gpg';
  const listPath = '/etc/apt/sources.list.d/tailscale.list';
  await runCmd('curl', ['-fsSL', `https://pkgs.tailscale.com/stable/${id}/${codename}.noarmor.gpg`, '-o', gpgPath], 30_000);
  await runCmd('curl', ['-fsSL', `https://pkgs.tailscale.com/stable/${id}/${codename}.tailscale-keyring.list`, '-o', listPath], 30_000);
  await runCmd('apt-get', ['update', '-qq'], 60_000);
  await runCmd('apt-get', ['install', '-y', '--no-install-recommends', 'tailscale'], 300_000);
  // LXC containers lack /dev/net/tun; switch to userspace networking
  const needsUserspace = isLxc() || !fs.existsSync('/dev/net/tun');
  if (needsUserspace) {
    const overrideDir = '/etc/systemd/system/tailscaled.service.d';
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(`${overrideDir}/lxc-userspace.conf`,
      '[Service]\nExecStart=\nExecStart=/usr/sbin/tailscaled --tun=userspace-networking' +
      ' --state=/var/lib/tailscale/tailscaled.state' +
      ' --socket=/run/tailscale/tailscaled.sock --port=41641\n');
    await runCmd('systemctl', ['daemon-reload'], 5_000);
  }
  await runCmd('systemctl', ['enable', '--now', 'tailscaled'], 10_000);
  // Connect if auth key is already configured
  let authKey = '';
  try {
    const content = fs.readFileSync(DOTENV_PATH, 'utf8');
    const m = content.match(/^TAILSCALE_AUTH_KEY=(.+)/m);
    if (m) authKey = m[1].trim().replaceAll(/^["']|["']$/g, '');
  } catch { /* no .env yet */ }
  if (authKey && !authKey.includes('\u2022')) {
    await runCmd('tailscale', ['up', `--authkey=${authKey}`, '--accept-routes'], 30_000).catch(() => {
      /* best-effort \u2014 component is still "installed" even if the initial connect fails */
    });
  }
}

function archSuffix() {
  if (os.arch() === 'arm64') return 'arm64';
  return 'amd64';
}

async function installCloudflared() {
  const arch = archSuffix();
  const url  = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
  await runCmd('curl', ['-fsSL', url, '-o', '/usr/local/bin/cloudflared'], 60_000);
  await runCmd('chmod', ['+x', '/usr/local/bin/cloudflared'], 3_000);
}

async function installRclone() {
  try {
    await runCmd('apt-get', ['install', '-y', '--no-install-recommends', 'rclone'], 120_000);
  } catch {
    const arch = archSuffix();
    const url  = `https://downloads.rclone.org/rclone-current-linux-${arch}.zip`;
    await runCmd('curl', ['-fsSL', url, '-o', '/tmp/rclone.zip'], 60_000);
    await runCmd('unzip', ['-qo', '/tmp/rclone.zip', '-d', '/tmp/rclone_x'], 30_000);
    const bin = await runCmd('bash', ['-c', 'ls /tmp/rclone_x/*/rclone 2>/dev/null | head -1'], 3_000).catch(() => '');
    if (!bin) throw new Error('Could not locate rclone binary after extraction');
    await runCmd('install', ['-m', '755', bin, '/usr/local/bin/rclone'], 3_000);
    await runCmd('rm', ['-rf', '/tmp/rclone.zip', '/tmp/rclone_x'], 5_000).catch(() => {});
  }
}

// ── Service lifecycle ───────────────────────────────────────────────────────

function serviceAction(action, req, res) {
  const { name } = req.params;
  if (!ALLOWED_SERVICES.has(name)) {
    return res.status(400).json({ error: 'Unknown service' });
  }
  const result = action(name);
  if (!result.ok) {
    return res.status(500).json({ error: result.message || `${action.name} failed` });
  }
  res.json({ ok: true });
}

// POST /api/v1/services/:name/start
router.post('/:name/start',   (req, res) => serviceAction(startService,   req, res));
// POST /api/v1/services/:name/stop
router.post('/:name/stop',    (req, res) => serviceAction(stopService,    req, res));
// POST /api/v1/services/:name/restart
router.post('/:name/restart', (req, res) => serviceAction(restartService, req, res));

module.exports = router;
