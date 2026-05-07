'use strict';

const router = require('express').Router();
const { spawnSync } = require('node:child_process');

const ALLOWED_SERVICES = new Set([
  'cups', 'ipp-usb', 'scanservjs', 'samba',
  'nfs', 'nginx', 'portal', 'paperless',
  'tailscale', 'cloudflared',
]);

const COMPOSE_FILE = process.env.COMPOSE_FILE || '/config/docker-compose.yml';

// POST /api/v1/services/:name/restart
router.post('/:name/restart', (req, res) => {
  const { name } = req.params;
  if (!ALLOWED_SERVICES.has(name)) {
    return res.status(400).json({ error: 'Unknown service' });
  }
  try {
    const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'restart', name], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `Restart failed with code ${result.status}`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

module.exports = router;
