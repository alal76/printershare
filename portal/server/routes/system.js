// Beta test version v1.2.0
'use strict';

const router   = require('express').Router();
const { execSync, spawnSync } = require('node:child_process');
const os       = require('node:os');
const { version: packageVersion } = require('../../package.json');
const { cupsCmd, scanCmd } = require('../lib/deployment');

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
    version:  process.env.npm_package_version || packageVersion,
  });
});

// GET /api/v1/system/usb
router.get('/usb', (_req, res) => {
  try {
    const { parseUsbDevices } = require('../services/usb-detect');
    const raw = execSync('lsusb 2>/dev/null', { timeout: 5000 }).toString();

    // Cross-reference with CUPS (printer source of truth) and SANE (scanners).
    const cupsPrinterMakes = collectCupsPrinterMakes();
    const saneUsbDevices   = collectSaneUsbDevices();

    const devices = parseUsbDevices(raw, { cupsPrinterMakes, saneUsbDevices });
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: 'USB detection failed', detail: String(err.message) });
  }
});

/**
 * Collect manufacturer names from CUPS-detected USB printers.
 * Parses `lpinfo -v` lines like `direct usb://Samsung/SCX-3400%20Series?...`.
 * @returns {string[]}
 */
function collectCupsPrinterMakes() {
  try {
    const { cmd, args } = cupsCmd(['lpinfo', '-v']);
    const r = spawnSync(cmd, args, { timeout: 8000, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const makes = new Set();
    const re = /usb:\/\/([^/?\s]+)\//g;
    let m;
    while ((m = re.exec(out)) !== null) {
      makes.add(decodeURIComponent(m[1]).toLowerCase());
    }
    return [...makes];
  } catch {
    return [];
  }
}

/**
 * Collect bus/device pairs of USB scanners detected by SANE.
 * Parses lines like `device `xerox_mfp:libusb:001:002' is a ...`.
 * @returns {Array<{bus:string, device:string}>}
 */
function collectSaneUsbDevices() {
  try {
    const { cmd, args } = scanCmd(['scanimage', '-L']);
    const r = spawnSync(cmd, args, { timeout: 8000, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const result = [];
    const re = /libusb:(\d{3}):(\d{3})/g;
    let m;
    while ((m = re.exec(out)) !== null) {
      result.push({ bus: m[1], device: m[2] });
    }
    return result;
  } catch {
    return [];
  }
}

module.exports = router;
