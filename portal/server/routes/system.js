'use strict';

const router   = require('express').Router();
const { execSync } = require('node:child_process');
const os       = require('node:os');

// GET /api/v1/system/info
router.get('/info', (_req, res) => {
  let serverIp = 'unknown';
  try {
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
      for (const addr of (iface || [])) {
        if (addr.family === 'IPv4' && !addr.internal) {
          serverIp = addr.address;
          break;
        }
      }
      if (serverIp !== 'unknown') break;
    }
  } catch { /* ignore */ }

  res.json({
    hostname: os.hostname(),
    ip:       serverIp,
    platform: os.platform(),
    arch:     os.arch(),
    uptime:   os.uptime(),
    version:  process.env.npm_package_version || '1.0.0',
  });
});

// GET /api/v1/system/usb
router.get('/usb', (_req, res) => {
  try {
    const { parseUsbDevices } = require('../services/usb-detect');
    const raw = execSync('lsusb 2>/dev/null', { timeout: 5000 }).toString();
    const devices = parseUsbDevices(raw);
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: 'USB detection failed', detail: String(err.message) });
  }
});

module.exports = router;
