// Beta test version v1.2.0
'use strict';

const router = require('express').Router();
const { execFile, spawnSync } = require('node:child_process');
const { isNative, serviceRunning, serviceConfigured } = require('../lib/deployment');

// In native mode, CUPS and scanservjs run on localhost; in Docker we
// reach them via the compose network DNS / host.docker.internal.
const CUPS_HOST           = process.env.CUPS_HOST           || (isNative() ? '127.0.0.1' : 'host.docker.internal');
const CUPS_PORT           = Number.parseInt(process.env.CUPS_PORT  || '631', 10);
const SCANSERVJS_INTERNAL = process.env.SCANSERVJS_INTERNAL || process.env.SCANSERVJS_URL || (isNative() ? 'http://127.0.0.1:8080' : 'http://ps-scanservjs:8080');
const PAPERLESS_INTERNAL  = process.env.PAPERLESS_INTERNAL  || 'http://ps-paperless:8000';
const SCANS_DISK_PATH     = process.env.SCANS_HOST_PATH || (isNative() ? '/srv/printershare/scans' : '/scans');

/**
 * Check disk usage of the filesystem holding the scans directory (`df`).
 * Not part of the restartable `services` map — it's a metric, not a
 * service — so the frontend surfaces it separately rather than growing a
 * "Restart"/"Stop" button for a disk.
 * @returns {{ percentUsed: number, availableGb: number, status: 'ok'|'warning'|'critical' } | null}
 */
function checkDiskSpace() {
  try {
    const r = spawnSync('df', ['-Pk', SCANS_DISK_PATH], { encoding: 'utf8', timeout: 3000 });
    if (r.status !== 0 || !r.stdout) return null;
    const lines = r.stdout.trim().split('\n');
    const fields = lines[lines.length - 1].trim().split(/\s+/);
    const totalKb = Number.parseInt(fields[1], 10);
    const usedKb  = Number.parseInt(fields[2], 10);
    const availKb = Number.parseInt(fields[3], 10);
    if (!Number.isFinite(totalKb) || totalKb <= 0) return null;
    const percentUsed  = Math.round((usedKb / totalKb) * 100);
    const availableGb  = Math.round((availKb / 1024 / 1024) * 10) / 10;
    const status = percentUsed >= 90 ? 'critical' : percentUsed >= 80 ? 'warning' : 'ok';
    return { percentUsed, availableGb, status };
  } catch {
    return null;
  }
}

/**
 * Parse COMPOSE_PROFILES env var into a Set of active profile names.
 * @returns {Set<string>}
 */
function activeProfiles() {
  const raw = process.env.COMPOSE_PROFILES || '';
  return new Set(raw.split(',').map(p => p.trim()).filter(Boolean));
}

/**
 * Probe an HTTP endpoint. Returns { ok, latency_ms, message? }.
 */
async function probe(url, timeoutMs = 5000) {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    return { ok: res.status < 500, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - start, message: String(err.message) };
  }
}

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Build a service status entry, returning `disabled` when the owning profile
 * is not active.
 */

/**
 * Module-level Tailscale status cache.  Refreshed every 60 s via an
 * unref'd setInterval so it never blocks the event loop during a request.
 * @type {{ connected: boolean, ip: string|null }}
 */
let _tailscaleCache = { connected: false, ip: null };

function _refreshTailscaleCache() {
  const handle = (err, stdout) => {
    if (err || !stdout) { _tailscaleCache = { connected: false, ip: null }; return; }
    try {
      const data      = JSON.parse(stdout.trim());
      const connected = data.BackendState === 'Running';
      const ip        = connected && data.Self?.TailscaleIPs?.length ? data.Self.TailscaleIPs[0] : null;
      _tailscaleCache = { connected, ip };
    } catch {
      _tailscaleCache = { connected: false, ip: null };
    }
  };
  if (isNative()) {
    execFile('tailscale', ['status', '--json'], { timeout: 5000, encoding: 'utf8' }, handle);
  } else {
    execFile('docker', ['exec', 'ps-tailscale', 'tailscale', 'status', '--json'], { timeout: 5000, encoding: 'utf8' }, handle);
  }
}

// Kick off immediately then refresh every 15 s; .unref() keeps it from
// blocking a clean process exit.
_refreshTailscaleCache();
setInterval(_refreshTailscaleCache, 15_000).unref();

/**
 * Check whether the Tailscale daemon inside ps-tailscale is connected.
 * Returns the most recently cached result (never blocks the event loop).
 * @returns {{ connected: boolean, ip: string|null }}
 */
function tailscaleStatus() {
  return _tailscaleCache;
}

/**
 * Build a service status entry, returning `disabled` when the owning profile
 * is not active.
 */
function serviceStatus(enabled, isUp, latencyMs = 0) {
  if (!enabled)  return { status: 'disabled', latency_ms: 0 };
  return { status: isUp ? 'ok' : 'offline', latency_ms: latencyMs };
}

// GET /api/v1/health
router.get('/', async (_req, res) => {
  const profiles = activeProfiles();
  const docsEnabled   = profiles.has('docs');
  const remoteEnabled = profiles.has('remote');
  const nfsEnabled    = profiles.has('nfs');

  // In native mode, whether a service is "present" is determined by whether
  // its systemd unit is enabled — Docker Compose profiles don't apply.
  const native = isNative();

  const [cups, scanservjs, paperless] = await Promise.all([
    probe(`http://${CUPS_HOST}:${CUPS_PORT}/`),
    probe(`${SCANSERVJS_INTERNAL}/api/v1/context`),
    docsEnabled ? probe(`${PAPERLESS_INTERNAL}/api/`) : Promise.resolve({ ok: false, latency_ms: 0 }),
  ]);

  const services = {
    cups:       { status: cups.ok       ? 'ok' : 'error', latency_ms: cups.latency_ms,      message: cups.message },
    'ipp-usb':  serviceStatus(serviceConfigured('ipp-usb'), serviceRunning('ipp-usb')),
    scanservjs: { status: scanservjs.ok ? 'ok' : 'error', latency_ms: scanservjs.latency_ms, message: scanservjs.message },
    paperless:  serviceStatus(docsEnabled,   paperless.ok, paperless.latency_ms),
    samba:      serviceStatus(serviceConfigured('samba'), serviceRunning('samba')),
    nfs:        serviceStatus(
      native ? serviceConfigured('nfs') : (nfsEnabled && serviceConfigured('nfs')),
      serviceRunning('nfs')
    ),
    tailscale:  (() => {
      const enabled = native ? serviceConfigured('tailscale') : (remoteEnabled && serviceConfigured('tailscale'));
      if (!enabled) return { status: 'disabled', latency_ms: 0 };
      const ts = tailscaleStatus();
      return { status: ts.connected ? 'ok' : 'offline', latency_ms: 0, ip: ts.ip };
    })(),
    cloudflare: serviceStatus(
      native ? serviceConfigured('cloudflared') : (remoteEnabled && serviceConfigured('cloudflared')),
      serviceRunning('cloudflared')
    ),
  };

  const hasError = Object.values(services).some(s => s.status === 'error');
  const disk = checkDiskSpace();

  res.json({
    status: hasError || disk?.status === 'critical' ? 'degraded' : 'ok',
    services,
    disk,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
