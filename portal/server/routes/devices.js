'use strict';

/**
 * @module routes/devices
 * @description Manage printers and scanners: list, add (via IPP URI), remove,
 * and test-print.  Printer mutations are performed through the `lpadmin` CLI
 * that is available inside the CUPS container.
 *
 * GET    /api/v1/devices            – Combined USB + CUPS device list.
 * POST   /api/v1/devices/printer    – Register a new CUPS printer.
 * DELETE /api/v1/devices/printer/:name  – Remove a CUPS printer.
 * POST   /api/v1/devices/printer/:name/test  – Print the CUPS test page.
 */

const router = require('express').Router();
const { execSync }   = require('node:child_process');
const { parseUsbDevices } = require('../services/usb-detect');

/** Allowed characters in a CUPS printer name. */
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Basic IPP/IPPS URI validation (no shell special chars). */
const SAFE_URI = /^ipps?:\/\/[A-Za-z0-9._\-:/]+$/;

/**
 * Run a command with execSync, capturing stdout as a string.
 * @param {string} cmd
 * @param {number} [timeout=10000]
 * @returns {string}
 */
function run(cmd, timeout = 10_000) {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Map an lpstat detail string to a printer state token.
 * @param {string} detail
 * @returns {'idle'|'busy'|'disabled'|'unknown'}
 */
function parsePrinterState(detail) {
  if (detail.startsWith('is idle'))    return 'idle';
  if (detail.startsWith('is busy'))    return 'busy';
  if (detail.startsWith('disabled'))   return 'disabled';
  return 'unknown';
}

/**
 * Fetch the device URI for a single CUPS printer via lpstat -v.
 * @param {string} name
 * @returns {string}
 */
function getPrinterUri(name) {
  try {
    const uriOut = run(`lpstat -v ${name}`, 3_000);
    const uriRe  = /device for \S+:\s*(\S+)/;
    const m      = uriRe.exec(uriOut);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/**
 * GET /api/v1/devices
 * Returns USB devices (from lsusb) and CUPS printers (from lpstat).
 */
router.get('/', (_req, res) => {
  // --- USB devices ---
  let usbRaw = '';
  try { usbRaw = run('lsusb', 5_000); } catch { /* lsusb not available */ }
  const usb = parseUsbDevices(usbRaw);

  // --- CUPS printers via lpstat -p ---
  const printers = [];
  try {
    const lpOut    = run('lpstat -p', 5_000);
    const printerRe = /^printer (\S+)\s+(.+)$/gm;
    let m;
    while ((m = printerRe.exec(lpOut)) !== null) {
      printers.push({
        name:  m[1],
        state: parsePrinterState(m[2]),
        uri:   getPrinterUri(m[1]),
      });
    }
  } catch { /* CUPS not available */ }

  res.json({ usb, printers });
});

/**
 * POST /api/v1/devices/printer
 * Body: { name: string, uri: string }
 * Registers a new CUPS printer using lpadmin with the driverless `everywhere`
 * model, enabling AirPrint discovery automatically.
 */
router.post('/printer', (req, res) => {
  const { name, uri } = req.body ?? {};

  if (!name || !SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name (alphanumeric, up to 64 chars)' });
  }
  if (!uri || !SAFE_URI.test(uri)) {
    return res.status(400).json({ error: 'Invalid IPP URI (must start with ipp:// or ipps://)' });
  }

  try {
    run(`lpadmin -p ${name} -E -v ${uri} -m everywhere`, 20_000);
    run(`lpadmin -d ${name}`, 5_000); // set as default
    res.json({ ok: true, name, uri });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

/**
 * DELETE /api/v1/devices/printer/:name
 * Removes the named CUPS printer.
 */
router.delete('/printer/:name', (req, res) => {
  const { name } = req.params;
  if (!SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name' });
  }
  try {
    run(`lpadmin -x ${name}`, 10_000);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

/**
 * POST /api/v1/devices/printer/:name/test
 * Prints the CUPS test page to the named printer.
 */
router.post('/printer/:name/test', (req, res) => {
  const { name } = req.params;
  if (!SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name' });
  }
  try {
    const out = run(`lp -d ${name} /usr/share/cups/data/testprint`, 15_000);
    res.json({ ok: true, message: out || 'Test page sent' });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

module.exports = router;
