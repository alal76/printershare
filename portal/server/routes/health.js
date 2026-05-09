'use strict';

const router = require('express').Router();
const { execSync, execFile } = require('node:child_process');

const CUPS_HOST           = process.env.CUPS_HOST           || 'host.docker.internal';
const CUPS_PORT           = Number.parseInt(process.env.CUPS_PORT  || '631', 10);
const SCANSERVJS_INTERNAL = process.env.SCANSERVJS_INTERNAL || 'http://ps-scanservjs:8080';
const PAPERLESS_INTERNAL  = process.env.PAPERLESS_INTERNAL  || 'http://ps-paperless:8000';

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
 * Check a Docker container is running.
 */
function containerRunning(name) {
  try {
    const out = execSync(`docker inspect --format='{{.State.Running}}' ${name} 2>/dev/null`, { timeout: 3000 })
      .toString().trim();
    return out === 'true';
  } catch {
    return false;
  }
}

/**
 * Module-level Tailscale status cache.  Refreshed every 60 s via an
 * unref'd setInterval so it never blocks the event loop during a request.
 * @type {{ connected: boolean, ip: string|null }}
 */
let _tailscaleCache = { connected: false, ip: null };

function _refreshTailscaleCache() {
  execFile('docker', ['exec', 'ps-tailscale', 'tailscale', 'status', '--json'], { timeout: 5000, encoding: 'utf8' }, (err, stdout) => {
    if (err || !stdout) { _tailscaleCache = { connected: false, ip: null }; return; }
    try {
      const data      = JSON.parse(stdout.trim());
      const connected = data.BackendState === 'Running';
      const ip        = connected && data.Self?.TailscaleIPs?.length ? data.Self.TailscaleIPs[0] : null;
      _tailscaleCache = { connected, ip };
    } catch {
      _tailscaleCache = { connected: false, ip: null };
    }
  });
}

// Kick off immediately then refresh every 60 s; .unref() keeps it from
// blocking a clean process exit.
_refreshTailscaleCache();
setInterval(_refreshTailscaleCache, 60_000).unref();

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

  const [cups, scanservjs, paperless] = await Promise.all([
    probe(`http://${CUPS_HOST}:${CUPS_PORT}/`),
    probe(`${SCANSERVJS_INTERNAL}/api/v1/context`),
    docsEnabled ? probe(`${PAPERLESS_INTERNAL}/api/`) : Promise.resolve({ ok: false, latency_ms: 0 }),
  ]);

  const services = {
    cups:       { status: cups.ok       ? 'ok' : 'error', latency_ms: cups.latency_ms,      message: cups.message },
    'ipp-usb':  serviceStatus(true,          containerRunning('ps-ipp-usb')),
    scanservjs: { status: scanservjs.ok ? 'ok' : 'error', latency_ms: scanservjs.latency_ms, message: scanservjs.message },
    paperless:  serviceStatus(docsEnabled,   paperless.ok, paperless.latency_ms),
    samba:      serviceStatus(true,          containerRunning('ps-samba')),
    nfs:        serviceStatus(true,          containerRunning('ps-nfs')),
    tailscale:  (() => {
      if (!remoteEnabled) return { status: 'disabled', latency_ms: 0 };
      const ts = tailscaleStatus();
      return { status: ts.connected ? 'ok' : 'offline', latency_ms: 0, ip: ts.ip };
    })(),
    cloudflare: serviceStatus(remoteEnabled, containerRunning('ps-cloudflared')),
  };

  const hasError = Object.values(services).some(s => s.status === 'error');

  res.json({
    status: hasError ? 'degraded' : 'ok',
    services,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
