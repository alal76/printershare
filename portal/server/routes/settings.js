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
const { spawn } = require('node:child_process');
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
  'CUPS_EXTRA_PACKAGES',
]);

function isValidPort(raw) {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function isValidCidr(raw) {
  return /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(String(raw));
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

module.exports = router;
module.exports.sanitizePatch = sanitizePatch;
