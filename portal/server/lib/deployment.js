'use strict';

/**
 * @module lib/deployment
 * @description Single source of truth for "where is each PrinterShare
 * service running?" — Docker Compose containers vs. native systemd units
 * on a bare-metal / LXC host.
 *
 * The deployment mode is read from the `DEPLOYMENT_MODE` env var:
 *
 *   - `docker` (default, back-compat) — services live in containers named
 *     `ps-cups`, `ps-scanservjs`, etc.; restart goes through
 *     `docker compose restart`; logs come from `docker logs -f`.
 *
 *   - `native` — services live as systemd units on the same host as the
 *     portal; commands like `lpadmin` and `scanimage` are invoked
 *     directly; restart goes through `systemctl restart`; logs come from
 *     `journalctl -u <unit> -f`.
 *
 * For back-compat, `CUPS_LOCAL=1` is also honoured as a synonym for
 * native mode (the native installer sets both).
 */

const { spawn, spawnSync } = require('node:child_process');

/** @type {'docker' | 'native'} */
function detectMode() {
  const explicit = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
  if (explicit === 'native' || explicit === 'docker') return explicit;
  if (process.env.CUPS_LOCAL === '1') return 'native';
  return 'docker';
}
const MODE = detectMode();

/**
 * Map a logical service name (as exposed by the API) to:
 *  - `container`  — docker container name (`docker` mode)
 *  - `unit`       — systemd unit name (`native` mode)
 *  - `compose`    — service key in docker-compose.yml (`docker` mode restart)
 *
 * Services not present in a given mode have a falsy entry, so callers can
 * report `disabled` cleanly instead of crashing.
 *
 * @type {Record<string, { container?: string, unit?: string, compose?: string }>}
 */
const SERVICE_MAP = {
  cups:        { container: 'ps-cups',        unit: 'cups.service',                  compose: 'cups' },
  'ipp-usb':   { container: 'ps-ipp-usb',     unit: 'ipp-usb.service',               compose: 'ipp-usb' },
  scanservjs:  { container: 'ps-scanservjs',  unit: 'scanservjs.service',            compose: 'scanservjs' },
  samba:       { container: 'ps-samba',       unit: 'smbd.service',                  compose: 'samba' },
  nfs:         { container: 'ps-nfs',         unit: 'nfs-kernel-server.service',     compose: 'nfs' },
  nginx:       { container: 'ps-nginx',       unit: 'nginx.service',                 compose: 'nginx' },
  portal:      { container: 'ps-portal',      unit: 'printershare-portal.service',   compose: 'portal' },
  paperless:   { container: 'ps-paperless',   /* no native unit */                   compose: 'paperless' },
  tailscale:   { container: 'ps-tailscale',   unit: 'tailscaled.service',            compose: 'tailscale' },
  cloudflared: { container: 'ps-cloudflared', unit: 'cloudflared.service',           compose: 'cloudflared' },
};

function isNative() { return MODE === 'native'; }
function isDocker() { return MODE === 'docker'; }

/**
 * Build the argv that should be passed to spawn/spawnSync to run a CUPS
 * CLI command in the current deployment mode.
 *
 * @param {string[]} cupsArgs e.g. ['lpstat', '-p']
 * @returns {{ cmd: string, args: string[] }}
 */
function cupsCmd(cupsArgs) {
  if (isNative()) return { cmd: cupsArgs[0], args: cupsArgs.slice(1) };
  return { cmd: 'docker', args: ['exec', SERVICE_MAP.cups.container, ...cupsArgs] };
}

/**
 * Build the argv for a SANE/scanimage command. In `docker` mode this
 * shells into the scanservjs container; in `native` mode it runs directly.
 *
 * @param {string[]} scanArgs e.g. ['scanimage', '-L']
 * @returns {{ cmd: string, args: string[] }}
 */
function scanCmd(scanArgs) {
  if (isNative()) return { cmd: scanArgs[0], args: scanArgs.slice(1) };
  return { cmd: 'docker', args: ['exec', SERVICE_MAP.scanservjs.container, ...scanArgs] };
}

/**
 * Run a CUPS CLI command synchronously.
 * @param {string[]} cupsArgs
 * @param {number}   [timeout=10000]
 * @returns {string}
 */
function runCupsSync(cupsArgs, timeout = 10_000) {
  const { cmd, args } = cupsCmd(cupsArgs);
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error((r.stderr || `exit ${r.status}`).slice(0, 400));
  }
  return (r.stdout || '').trim();
}

/**
 * Run a SANE / scanimage command synchronously.
 * @param {string[]} scanArgs
 * @param {number}   [timeout=10000]
 * @returns {string}
 */
function runScanSync(scanArgs, timeout = 10_000) {
  const { cmd, args } = scanCmd(scanArgs);
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error((r.stderr || `exit ${r.status}`).slice(0, 400));
  }
  return (r.stdout || '').trim();
}

/**
 * Check whether a logical service is currently up.
 *
 * Docker mode → `docker inspect --format '{{.State.Running}}' ps-<svc>` == "true"
 * Native mode → `systemctl is-active <unit>` == "active"
 *
 * @param {string} name  Logical service key (e.g. 'cups', 'scanservjs').
 * @returns {boolean}
 */
function serviceRunning(name) {
  const entry = SERVICE_MAP[name];
  if (!entry) return false;
  if (isNative()) {
    if (!entry.unit) return false;
    const r = spawnSync('systemctl', ['is-active', entry.unit], { encoding: 'utf8', timeout: 3_000 });
    return (r.stdout || '').trim() === 'active';
  }
  if (!entry.container) return false;
  const r = spawnSync('docker', ['inspect', '--format={{.State.Running}}', entry.container], {
    encoding: 'utf8', timeout: 3_000,
  });
  return (r.stdout || '').trim() === 'true';
}

/**
 * Check whether a logical service is *configured* in the current deployment.
 *
 * Docker mode → always true (we assume the compose file defines it; the
 *   caller distinguishes "in profile" via COMPOSE_PROFILES).
 * Native mode → `systemctl is-enabled <unit>` returns one of the
 *   "actively enabled" states. We deliberately reject `static`, `masked`,
 *   `disabled`, `indirect`, and `generated` — Debian ships several units
 *   (e.g. `ipp-usb.service`) as `static`, meaning the unit file exists but
 *   is only intended to be triggered on demand. Treating those as
 *   "configured" gives a misleading "offline" rather than the correct
 *   "disabled" / not-part-of-this-install signal.
 *
 * Used by /api/v1/health to surface `disabled` (not part of this install)
 * vs `offline` (installed but not running).
 *
 * @param {string} name
 * @returns {boolean}
 */
const ENABLED_STATES = new Set(['enabled', 'enabled-runtime', 'alias', 'linked', 'linked-runtime']);
function serviceConfigured(name) {
  const entry = SERVICE_MAP[name];
  if (!entry) return false;
  if (!isNative()) return Boolean(entry.container);
  if (!entry.unit) return false;
  const r = spawnSync('systemctl', ['is-enabled', entry.unit], { encoding: 'utf8', timeout: 3_000 });
  return ENABLED_STATES.has((r.stdout || '').trim());
}

/**
 * Restart a logical service.
 * @param {string} name
 * @param {number} [timeout=30000]
 * @returns {{ ok: boolean, message?: string }}
 */
function restartService(name, timeout = 30_000) {
  const entry = SERVICE_MAP[name];
  if (!entry) return { ok: false, message: `Unknown service: ${name}` };

  if (isNative()) {
    if (!entry.unit) return { ok: false, message: `${name} has no native unit` };
    const r = spawnSync('systemctl', ['restart', entry.unit], { encoding: 'utf8', timeout });
    if (r.status !== 0) return { ok: false, message: (r.stderr || `exit ${r.status}`).slice(0, 400) };
    return { ok: true };
  }
  if (!entry.compose) return { ok: false, message: `${name} has no compose key` };
  const composeFile = process.env.COMPOSE_FILE || '/config/docker-compose.yml';
  const r = spawnSync('docker', ['compose', '-f', composeFile, 'restart', entry.compose], {
    encoding: 'utf8', timeout,
  });
  if (r.status !== 0) {
    return { ok: false, message: (r.stderr || r.stdout || `exit ${r.status}`).slice(0, 400) };
  }
  return { ok: true };
}

/**
 * Spawn a long-running log streamer for a service. Returns the
 * ChildProcess so the caller can hook stdout/stderr/close events.
 *
 * Docker mode → `docker logs --follow --tail=<lines> <container>`
 * Native mode → `journalctl -u <unit> -n <lines> -f`
 *
 * @param {string} name   Logical service key.
 * @param {number} [lines=200]
 * @returns {import('node:child_process').ChildProcess}
 */
function streamLogs(name, lines = 200) {
  const entry = SERVICE_MAP[name];
  if (!entry) throw new Error(`Unknown service: ${name}`);
  if (isNative()) {
    if (!entry.unit) throw new Error(`${name} has no native unit`);
    return spawn('journalctl', ['-u', entry.unit, '-n', String(lines), '-f', '--no-pager']);
  }
  if (!entry.container) throw new Error(`${name} has no container`);
  return spawn('docker', ['logs', '--follow', `--tail=${lines}`, entry.container]);
}

module.exports = {
  MODE,
  SERVICE_MAP,
  isNative,
  isDocker,
  cupsCmd,
  scanCmd,
  runCupsSync,
  runScanSync,
  serviceRunning,
  serviceConfigured,
  restartService,
  streamLogs,
};
