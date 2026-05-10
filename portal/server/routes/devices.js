'use strict';

/**
 * @module routes/devices
 * @description Manage printers and scanners: list, add (via IPP URI), remove,
 * and test-print.  Printer mutations are performed through the `lpadmin` CLI
 * inside the CUPS container (the portal container itself has no CUPS client).
 *
 * GET    /api/v1/devices            – Combined USB + CUPS device list.
 * POST   /api/v1/devices/printer    – Register a new CUPS printer.
 * POST   /api/v1/devices/printer/auto-add – Auto-detect URI from a USB device.
 * DELETE /api/v1/devices/printer/:name  – Remove a CUPS printer.
 * POST   /api/v1/devices/printer/:name/test  – Print the CUPS test page.
 * POST   /api/v1/devices/reset      – Remove all CUPS printers + clear wizard.
 */

const router = require('express').Router();
const fs     = require('node:fs');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseUsbDevices } = require('../services/usb-detect');

/** Allowed characters in a CUPS printer name. */
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Validate IPP/IPPS URI submitted by the user. */
const SAFE_IPP_URI = /^ipps?:\/\/[A-Za-z0-9._\-:/]+$/;

/** Validate `usb://Make/Model?...` URIs returned by CUPS lpinfo. */
const SAFE_USB_URI = /^usb:\/\/[A-Za-z0-9%._\-/+]{1,128}\?[A-Za-z0-9%._\-=&]{0,256}$/;

/** USB vid:pid format. */
const SAFE_VIDPID = /^[0-9a-f]{4}:[0-9a-f]{4}$/i;

/**
 * Run a command with an explicit arg array (no shell), capturing stdout.
 * @param {string[]} args  First element is the executable; the rest are arguments.
 * @param {number}   [timeout=10000]
 * @returns {string}
 */
function run(args, timeout = 10_000) {
  const result = spawnSync(args[0], args.slice(1), {
    encoding: 'utf8',
    timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || `Command failed with exit ${result.status}`).slice(0, 400));
  }
  return (result.stdout || '').trim();
}

/**
 * Run a CUPS CLI command inside the ps-cups container.
 * @param {string[]} cupsArgs  Args after the container name (e.g. ['lpstat', '-p']).
 * @param {number}   [timeout]
 */
function runCups(cupsArgs, timeout = 10_000) {
  return run(['docker', 'exec', 'ps-cups', ...cupsArgs], timeout);
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
    const uriOut = runCups(['lpstat', '-v', name], 3_000);
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
  try { usbRaw = run(['lsusb'], 5_000); } catch { /* lsusb not available */ }
  const usb = parseUsbDevices(usbRaw, {
    cupsPrinterMakes: collectCupsPrinterMakes(),
    saneUsbDevices:   collectSaneUsbDevices(),
  });

  // --- CUPS printers via lpstat -p ---
  const printers = [];
  try {
    const lpOut    = runCups(['lpstat', '-p'], 5_000);
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
 * Collect manufacturer names from CUPS-detected USB printers (`lpinfo -v`).
 * @returns {string[]} lowercased makes
 */
function collectCupsPrinterMakes() {
  try {
    const out = runCups(['lpinfo', '-v'], 8_000);
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
 * @returns {Array<{bus:string, device:string}>}
 */
function collectSaneUsbDevices() {
  try {
    const r = spawnSync('docker', ['exec', 'ps-scanservjs', 'scanimage', '-L'], {
      timeout: 8000, encoding: 'utf8',
    });
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

/**
 * Look up the CUPS device URI for a given USB vid:pid.
 * Runs `lpinfo --include-schemes=usb -lv` and matches by device-id.
 * @param {string} vidpid
 * @returns {{ uri: string, make: string, model: string } | null}
 */
function findCupsUriForVidPid(vidpid) {
  try {
    const out = runCups(['lpinfo', '--include-schemes=usb', '-l', '-v'], 10_000);
    // lpinfo -l output blocks:
    //   Device: uri = usb://Samsung/SCX-3400%20Series?serial=…
    //           class = direct
    //           make-and-model = Samsung SCX-3400 Series
    //           device-id = MFG:Samsung;CMD:SPL,GDI;MDL:SCX-3400 Series;
    const blocks = out.split(/^Device:/m).slice(1);
    for (const blk of blocks) {
      const uriMatch  = /uri\s*=\s*(\S+)/.exec(blk);
      const mmMatch   = /make-and-model\s*=\s*([^\n]+)/.exec(blk);
      if (!uriMatch) continue;
      const uri = uriMatch[1];
      // Pull make/model from the URI itself: usb://<Make>/<Model>?…
      const usbRe = /^usb:\/\/([^/?]+)\/([^?]+)/;
      const u = usbRe.exec(uri);
      const make  = u ? decodeURIComponent(u[1]) : '';
      let model = '';
      if (u) model = decodeURIComponent(u[2]);
      else if (mmMatch) model = mmMatch[1].trim();

      // Match: the lsusb description contains the make and model,
      // or the device-id MFG matches a known vendor for this vidpid.
      if (vidpidMatchesMake(vidpid, make)) {
        return { uri, make, model };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Map known USB vendor IDs to manufacturer name fragments. */
const VID_TO_MAKE = {
  '03f0': 'hp', '04a9': 'canon', '04b8': 'epson', '04e8': 'samsung',
  '04f9': 'brother', '0482': 'kyocera', '043d': 'lexmark', '0924': 'xerox',
  '05ca': 'ricoh',
};

function vidpidMatchesMake(vidpid, make) {
  const vid = vidpid.split(':')[0]?.toLowerCase();
  const expected = VID_TO_MAKE[vid];
  if (!expected) return false;
  return make.toLowerCase().includes(expected);
}

/**
 * Suggest a CUPS-safe printer name from a make/model string.
 */
function suggestPrinterName(make, model) {
  const raw = `${make}_${model}`.replaceAll(/\s+/g, '_').replaceAll(/[^A-Za-z0-9_-]/g, '');
  return raw.slice(0, 64) || 'Printer';
}

/**
 * POST /api/v1/devices/printer
 * Body: { name: string, uri: string }
 * Registers a new CUPS printer using lpadmin. The `everywhere` (driverless)
 * model is used for IPP/IPPS URIs; for `usb://` URIs CUPS auto-selects the
 * best matching driver from installed PPDs.
 */
router.post('/printer', (req, res) => {
  const { name, uri } = req.body ?? {};

  if (!name || !SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name (alphanumeric, up to 64 chars)' });
  }
  const isIpp = SAFE_IPP_URI.test(uri || '');
  const isUsb = SAFE_USB_URI.test(uri || '');
  if (!uri || (!isIpp && !isUsb)) {
    return res.status(400).json({ error: 'Invalid URI (must start with ipp://, ipps:// or usb://)' });
  }

  try {
    const adminArgs = ['lpadmin', '-p', name, '-E', '-v', uri];
    if (isIpp) adminArgs.push('-m', 'everywhere');
    runCups(adminArgs, 30_000);
    runCups(['lpadmin', '-d', name], 5_000); // set as default
    res.json({ ok: true, name, uri });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

/**
 * POST /api/v1/devices/printer/auto-add
 * Body: { vidpid: string, name?: string }
 * Looks up the CUPS device URI for a USB vid:pid and registers it as a printer.
 */
router.post('/printer/auto-add', (req, res) => {
  const { vidpid, name } = req.body ?? {};
  if (!vidpid || !SAFE_VIDPID.test(vidpid)) {
    return res.status(400).json({ error: 'Invalid vidpid (expect xxxx:xxxx hex)' });
  }
  const found = findCupsUriForVidPid(vidpid);
  if (!found) {
    return res.status(404).json({
      error: 'No CUPS device URI matched this USB device',
      hint:  'Verify the device is powered on and `lpinfo -v` lists it inside ps-cups.',
    });
  }

  const printerName = (name && SAFE_NAME.test(name))
    ? name
    : suggestPrinterName(found.make, found.model);

  try {
    runCups(['lpadmin', '-p', printerName, '-E', '-v', found.uri], 30_000);
    runCups(['lpadmin', '-d', printerName], 5_000);
    res.json({ ok: true, name: printerName, uri: found.uri, make: found.make, model: found.model });
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
    runCups(['lpadmin', '-x', name], 10_000);
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
    const out = runCups(['lp', '-d', name, '/usr/share/cups/data/testprint'], 15_000);
    res.json({ ok: true, message: out || 'Test page sent' });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

/**
 * POST /api/v1/devices/reset
 * Removes every CUPS printer queue and clears the wizard's persisted state,
 * so the user can re-run device discovery from scratch.
 */
router.post('/reset', (_req, res) => {
  const removed = [];
  const errors  = [];
  try {
    const lpOut = runCups(['lpstat', '-p'], 5_000);
    const printerRe = /^printer (\S+)\s/gm;
    let m;
    while ((m = printerRe.exec(lpOut)) !== null) {
      const queue = m[1];
      try { runCups(['lpadmin', '-x', queue], 10_000); removed.push(queue); }
      catch (e) { errors.push(`${queue}: ${String(e.message).slice(0, 100)}`); }
    }
  } catch { /* CUPS unreachable — nothing to remove */ }

  // Clear the wizard's persisted state so the setup flow restarts.
  const dataDir = process.env.PORTAL_DATA_DIR || '/app/data';
  const stateFile = path.join(dataDir, 'wizard-state.json');
  try { if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile); }
  catch (e) { errors.push(`wizard-state: ${String(e.message).slice(0, 100)}`); }

  res.json({ ok: errors.length === 0, removed, errors });
});

module.exports = router;
