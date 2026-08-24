// Beta test version v1.2.0
'use strict';

/**
 * @module routes/settings
 * @description REST endpoints for reading and writing the `.env` runtime
 * configuration file that is bind-mounted into the container.
 *
 * GET  /api/v1/settings       – Returns all keys (sensitive values redacted).
 * PATCH /api/v1/settings      – Merges a partial key-value object into the
 *                               file; unknown keys are appended.
 */

const router = require('express').Router();
const { spawn, execFile } = require('node:child_process');
const { readEnv, writeEnvPatch, REDACT_PLACEHOLDER } = require('../lib/env');
const { setRuntimeAuth, setRuntimePassword } = require('../lib/auth');
const { isNative } = require('../lib/deployment');

const ALLOWED_SETTINGS = new Set([
  'NGINX_HTTP_PORT',
  'NGINX_HTTPS_PORT',
  'CUPS_HOST',
  'CUPS_PORT',
  'SAMBA_WORKGROUP',
  'SAMBA_SHARE',
  'SAMBA_PASS',
  'NFS_ALLOWED_SUBNET',
  'PORTAL_SECRET',
  'PORTAL_AUTH',
  'PORTAL_PASS',
  'PORTAL_USER',
  'TAILSCALE_AUTH_KEY',
  'CLOUDFLARE_TUNNEL_TOKEN',
  'COMPOSE_PROFILES',
  'RCLONE_GDRIVE_REMOTE',
  'RCLONE_ONEDRIVE_REMOTE',
  'SCANS_HOST_PATH',
  'SCANS_RETENTION_DAYS',
  'CUPS_EXTRA_PACKAGES',
  'LOG_LEVEL',
]);

function isValidPort(raw) {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function isValidCidr(raw) {
  return /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(String(raw));
}

/** 0 (or blank, handled by caller) means "keep forever". */
function isValidRetentionDays(raw) {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n >= 0 && n <= 3650;
}

function validateValue(key, val) {
  if (key.endsWith('_PORT') && !isValidPort(val)) {
    throw new Error(`Invalid port for ${key}`);
  }
  if (key === 'NFS_ALLOWED_SUBNET' && val && !isValidCidr(val)) {
    throw new Error('Invalid NFS_ALLOWED_SUBNET (expected CIDR)');
  }
  if (key === 'PORTAL_PASS' && val && val.length < 8) {
    throw new Error('PORTAL_PASS must be at least 8 characters');
  }
  if (key === 'SCANS_RETENTION_DAYS' && val !== '' && !isValidRetentionDays(val)) {
    throw new Error('SCANS_RETENTION_DAYS must be a whole number of days (0 = keep forever)');
  }
  if (key === 'LOG_LEVEL' && val && !['debug', 'info', 'warn', 'error'].includes(String(val).toLowerCase())) {
    throw new Error('LOG_LEVEL must be one of debug, info, warn, error');
  }
}

function sanitizePatch(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED_SETTINGS.has(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;

    const val = String(value);
    // Never write the redacted placeholder back — it means the client loaded
    // the value as a secret, didn't change it, and is sending the sentinel.
    if (val === REDACT_PLACEHOLDER) continue;
    validateValue(key, val);
    clean[key] = val;
  }
  return clean;
}

/**
 * GET /api/v1/settings
 * @returns {Record<string, string>} All .env keys; sensitive values replaced
 *   with {@link REDACT_PLACEHOLDER}.
 */
router.get('/', (_req, res) => {
  res.json(readEnv(undefined, true));
});

/**
 * PATCH /api/v1/settings
 * @param {Record<string, string>} req.body - Key-value pairs to update.
 */
router.patch('/', (req, res) => {
  const patch = req.body;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return res.status(400).json({ error: 'Expected a JSON object' });
  }
  try {
    const clean = sanitizePatch(patch);
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: 'No valid settings provided' });
    }
    writeEnvPatch(clean);
    // Hot-apply auth changes without requiring a restart.
    if ('PORTAL_AUTH' in clean) {
      setRuntimeAuth(clean['PORTAL_AUTH'] === 'true');
    }
    if ('PORTAL_PASS' in clean && clean['PORTAL_PASS']) {
      setRuntimePassword(clean['PORTAL_PASS']);
    }
    // Hot-apply Tailscale auth key — connect immediately in native mode.
    if ('TAILSCALE_AUTH_KEY' in clean && isNative()) {
      // sanitizePatch ensures all values are strings; use entries() to
      // extract in a form the linter can verify is a string.
      for (const [k, v] of Object.entries(clean)) {
        if (k === 'TAILSCALE_AUTH_KEY' && v) {
          const proc = spawn('tailscale', ['up', '--authkey='.concat(v), '--accept-routes'], {
            detached: true, stdio: 'ignore',
          });
          proc.unref();
          break;
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message) });
  }
});

/**
 * POST /api/v1/settings/tailscale/login
 * Starts an interactive Tailscale login instead of requiring a pre-generated
 * auth key: runs `tailscale up` with no `--authkey`, which makes the
 * tailscaled daemon print a one-time login URL and then wait for the user
 * to complete authentication in *any* browser (this is a headless server —
 * there's no local browser to open it for them). We capture that URL from
 * the process's output and hand it back to the portal UI as a link; the
 * `tailscale up` process itself keeps running detached in the background
 * and connects on its own once the user finishes the login in their
 * browser (health.js's existing status poll picks up the new state).
 */
router.post('/tailscale/login', (req, res) => {
  if (!isNative()) {
    return res.status(400).json({ error: 'Only available in native deployment mode' });
  }

  const child = spawn('tailscale', ['up', '--accept-routes'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buf = '';
  let responded = false;
  const URL_RE = /(https:\/\/login\.tailscale\.com\/\S+)/;

  const onData = (chunk) => {
    buf += chunk.toString();
    const m = URL_RE.exec(buf);
    if (m && !responded) {
      responded = true;
      clearTimeout(timer);
      res.json({ url: m[1] });
      // The child keeps running in the background to complete the login
      // once the user visits the URL — don't kill it, just stop listening.
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.unref();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (err) => {
    if (!responded) {
      responded = true;
      clearTimeout(timer);
      res.status(500).json({ error: `Failed to start tailscale: ${err.message}` });
    }
  });

  child.on('close', (code) => {
    if (!responded) {
      responded = true;
      clearTimeout(timer);
      if (code === 0) {
        // Already logged in / reconnected without needing a fresh login.
        res.json({ alreadyConnected: true });
      } else {
        res.status(500).json({ error: (buf || `tailscale up exited ${code}`).slice(0, 300) });
      }
    }
  });

  // If neither a URL nor an exit shows up quickly, don't hang the request
  // forever — report back what we have so far and let the client poll
  // /api/v1/health for connection status instead.
  const timer = setTimeout(() => {
    if (!responded) {
      responded = true;
      res.status(202).json({ pending: true, log: buf.slice(0, 300) });
    }
  }, 15_000);
});

/**
 * POST /api/v1/settings/tailscale/logout
 * Disconnects and clears the current Tailscale identity, so a different
 * account can be used with a fresh browser login.
 */
router.post('/tailscale/logout', (_req, res) => {
  if (!isNative()) {
    return res.status(400).json({ error: 'Only available in native deployment mode' });
  }
  execFile('tailscale', ['logout'], { timeout: 10_000, encoding: 'utf8' }, (err, _stdout, stderr) => {
    if (err) return res.status(500).json({ error: (stderr || err.message).slice(0, 300) });
    res.json({ ok: true });
  });
});

module.exports = router;
module.exports.sanitizePatch = sanitizePatch;
