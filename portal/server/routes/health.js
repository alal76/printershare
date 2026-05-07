'use strict';

const router = require('express').Router();
const http   = require('node:http');
const { execSync } = require('node:child_process');

const CUPS_HOST           = process.env.CUPS_HOST           || 'host.docker.internal';
const CUPS_PORT           = Number.parseInt(process.env.CUPS_PORT  || '631', 10);
const SCANSERVJS_INTERNAL = process.env.SCANSERVJS_INTERNAL || 'http://ps-scanservjs:8080';
const PAPERLESS_INTERNAL  = process.env.PAPERLESS_INTERNAL  || 'http://ps-paperless:8000';

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

// GET /api/v1/health
router.get('/', async (_req, res) => {
  const [cups, scanservjs, paperless] = await Promise.all([
    probe(`http://${CUPS_HOST}:${CUPS_PORT}/`),
    probe(`${SCANSERVJS_INTERNAL}/api/v1/context`),
    probe(`${PAPERLESS_INTERNAL}/api/`),
  ]);

  const ippUsb    = containerRunning('ps-ipp-usb');
  const samba     = containerRunning('ps-samba');
  const nfs       = containerRunning('ps-nfs');
  const tailscale = containerRunning('ps-tailscale');
  const cloudflare = containerRunning('ps-cloudflared');

  const services = {
    cups:       { status: cups.ok      ? 'ok' : 'error',   latency_ms: cups.latency_ms,      message: cups.message },
    'ipp-usb':  { status: ippUsb       ? 'ok' : 'offline', latency_ms: 0 },
    scanservjs: { status: scanservjs.ok ? 'ok' : 'error',  latency_ms: scanservjs.latency_ms, message: scanservjs.message },
    paperless:  { status: paperless.ok  ? 'ok' : 'offline', latency_ms: paperless.latency_ms },
    samba:      { status: samba         ? 'ok' : 'offline', latency_ms: 0 },
    nfs:        { status: nfs           ? 'ok' : 'offline', latency_ms: 0 },
    tailscale:  { status: tailscale     ? 'ok' : 'offline', latency_ms: 0 },
    cloudflare: { status: cloudflare    ? 'ok' : 'offline', latency_ms: 0 },
  };

  const hasError = Object.values(services).some(s => s.status === 'error');

  res.json({
    status: hasError ? 'degraded' : 'ok',
    services,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
