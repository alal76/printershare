// Beta test version v1.2.0
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
const { cupsCmd, scanCmd } = require('../lib/deployment');

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
 * Run a CUPS CLI command (`docker exec ps-cups ...` in Docker mode, or
 * the bare command in native mode — see `lib/deployment`).
 * @param {string[]} cupsArgs  e.g. ['lpstat', '-p']
 * @param {number}   [timeout]
 */
function runCups(cupsArgs, timeout = 10_000) {
  const { cmd, args } = cupsCmd(cupsArgs);
  return run([cmd, ...args], timeout);
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
 * Parse one line from `lpstat -p -l` output and update the entry.
 * @param {string} trimmed
 * @param {{ stateReasons:string[], accepting:boolean, location:string, info:string }} entry
 */
function parseLpstatLongLine(trimmed, entry) {
  const reasonM = /^Printer\s+State\s+Reasons:\s+(.+)$/i.exec(trimmed);
  if (reasonM) {
    entry.stateReasons = reasonM[1].split(/[,\s]+/).filter(r => r && r !== 'none');
    return;
  }
  const locationM = /^Location:\s+(.+)$/i.exec(trimmed);
  if (locationM) { entry.location = locationM[1]; return; }
  const infoM = /^Description:\s+(.+)$/i.exec(trimmed);
  if (infoM) { entry.info = infoM[1]; }
}

/**
 * Parse `lpstat -p -l` long output to extract rich per-printer state.
 * Returns a map of printerName -> { stateReasons, accepting, location, info }
 * @returns {Record<string, {stateReasons:string[], accepting:boolean, location:string, info:string}>}
 */
function getRichPrinterInfo() {
  const result = {};
  try {
    const longOut = runCups(['lpstat', '-p', '-l'], 8_000);
    let currentPrinter = null;
    for (const raw of longOut.split('\n')) {
      const printerM = /^printer (\S+)\s/.exec(raw);
      if (printerM) {
        currentPrinter = printerM[1];
        result[currentPrinter] = { stateReasons: [], accepting: true, location: '', info: '' };
        continue;
      }
      if (currentPrinter) parseLpstatLongLine(raw.trim(), result[currentPrinter]);
    }
    // lpstat -a: accepting status
    const acceptOut = runCups(['lpstat', '-a'], 5_000);
    for (const line of acceptOut.split('\n')) {
      const m = /^(\S+)\s+(accepting|not accepting)/i.exec(line.trim());
      if (m && result[m[1]]) {
        result[m[1]].accepting = m[2].toLowerCase() === 'accepting';
      }
    }
  } catch { /* CUPS unreachable */ }
  return result;
}

/**
 * Get active job counts per printer.
 * @returns {Record<string, number>}
 */
function getJobCounts() {
  const counts = {};
  try {
    const out = runCups(['lpstat', '-W', 'not-completed'], 5_000);
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const m = /^(\S+)-\d+/.exec(line.trim());
      if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
  } catch { /* ok */ }
  return counts;
}

/**
 * Derive a human-readable status message from CUPS state reasons.
 * @param {string[]} reasons
 * @returns {string}
 */
function stateReasonToMessage(reasons) {
  const map = {
    'media-empty':          'Paper out',
    'media-low':            'Paper low',
    'media-jam':            'Paper jam',
    'toner-empty':          'Toner empty',
    'toner-low':            'Toner low',
    'ink-empty':            'Ink empty',
    'ink-low':              'Ink low',
    'cover-open':           'Cover open',
    'door-open':            'Door open',
    'offline':              'Offline',
    'offline-report':       'Offline',
    'other':                'Error',
    'paused':               'Paused',
    'sleep':                'Sleeping',
    'connecting-to-device': 'Connecting',
    'cups-waiting-for-job-completed': 'Finishing',
  };
  for (const r of reasons) {
    const key = r.replace(/-report$/, '').replace(/-warning$/, '').toLowerCase();
    if (map[key]) return map[key];
  }
  return reasons.length > 0 ? reasons[0] : '';
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
  // Run `scanimage -L` exactly once and reuse the output for both the
  // /scanners list and the lsusb capability annotation. Probing SANE on
  // the SCX-3400 takes ~6-8s per call; calling it twice doubled the
  // /api/v1/devices latency for no reason.
  const saneRaw = collectSaneRaw();

  // --- USB devices ---
  let usbRaw = '';
  try { usbRaw = run(['lsusb'], 5_000); } catch { /* lsusb not available */ }
  const usb = parseUsbDevices(usbRaw, {
    cupsPrinterMakes: collectCupsPrinterMakes(),
    saneUsbDevices:   parseSaneUsbDevices(saneRaw),
  });

  // --- CUPS printers via lpstat -p ---
  const printers = [];
  try {
    const lpOut    = runCups(['lpstat', '-p'], 5_000);
    const richInfo = getRichPrinterInfo();
    const jobCounts = getJobCounts();
    const printerRe = /^printer (\S+)\s+(.+)$/gm;
    let m;
    while ((m = printerRe.exec(lpOut)) !== null) {
      const name  = m[1];
      const state = parsePrinterState(m[2]);
      const rich  = richInfo[name] ?? { stateReasons: [], accepting: true, location: '', info: '' };
      printers.push({
        name,
        state,
        uri:          getPrinterUri(name),
        accepting:    rich.accepting,
        stateReasons: rich.stateReasons,
        statusMsg:    stateReasonToMessage(rich.stateReasons),
        location:     rich.location,
        info:         rich.info,
        jobCount:     jobCounts[name] ?? 0,
      });
    }
  } catch { /* CUPS not available */ }

  // --- SANE scanners via cached scanimage -L output ---
  const scanners = parseSaneScanners(saneRaw);

  res.json({ usb, printers, scanners });
});

/**
 * Parse `scanimage -L` output into a list of scanner descriptors.
 * Output format:
 *   device `xerox_mfp:libusb:001:002' is a Samsung SCX-3400 Series ...
 * @returns {Array<{device:string, vendor:string, model:string, type:string}>}
 */
/**
 * Run `scanimage -L` once and return its combined stdout+stderr. Helpers
 * that need different views of the data (scanner descriptors / USB
 * bus:device pairs) parse this raw output instead of re-invoking the CLI.
 * @returns {string}
 */
function collectSaneRaw() {
  try {
    const { cmd, args } = scanCmd(['scanimage', '-L']);
    const r = spawnSync(cmd, args, { timeout: 10_000, encoding: 'utf8' });
    return (r.stdout || '') + (r.stderr || '');
  } catch {
    return '';
  }
}

/** @param {string} raw */
function parseSaneScanners(raw) {
  const out = [];
  const re = /^device `([^']+)'\s+is\s+a\s+(\S+)\s+(.+?)\s+(\S+)\s*$/gm;
  let m;
  while ((m = re.exec(raw)) !== null) {
    out.push({ device: m[1], vendor: m[2], model: m[3], type: m[4] });
  }
  return out;
}

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
/** @param {string} raw */
function parseSaneUsbDevices(raw) {
  const result = [];
  const re = /libusb:(\d{3}):(\d{3})/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    result.push({ bus: m[1], device: m[2] });
  }
  return result;
}

/**
 * Look up the CUPS device URI for a given USB vid:pid.
 *
 * Strategy:
 *  1. Parse `lpinfo -v` for `usb://Make/Model?...` lines whose Make matches
 *     the vendor ID (preferred — uses CUPS' own device-id query).
 *  2. Fallback: synthesize the URI from /sys/bus/usb/devices/<n>/{manufacturer,
 *     product, serial}. CUPS' libusb backend matches URIs against the USB
 *     descriptor strings, so a synthesized `usb://Samsung/SCX-3400%20Series`
 *     resolves at print time even when device-ID parsing fails.
 *
 * @param {string} vidpid
 * @returns {{ uri: string, make: string, model: string } | null}
 */
function findCupsUriForVidPid(vidpid) {
  // 1) Authoritative: CUPS lpinfo
  try {
    const out = runCups(['lpinfo', '-v'], 10_000);
    const usbLineRe = /^\s*\S+\s+(usb:\/\/([^/?]+)\/([^?\s]+)(?:\?\S*)?)/gm;
    let m;
    while ((m = usbLineRe.exec(out)) !== null) {
      const [, uri, makeEnc, modelEnc] = m;
      const make  = decodeURIComponent(makeEnc);
      const model = decodeURIComponent(modelEnc);
      if (make.toLowerCase() === 'unknown') continue;
      if (vidpidMatchesMake(vidpid, make)) {
        return { uri, make, model };
      }
    }
  } catch { /* fall through to sysfs */ }

  // 2) Fallback: read sysfs USB descriptors directly inside the cups container.
  try {
    const sysfs = readSysfsUsbDevice(vidpid);
    if (sysfs) {
      const make  = shortMakeForVid(vidpid) || sysfs.manufacturer;
      const model = sysfs.product;
      const params = sysfs.serial ? `?serial=${encodeURIComponent(sysfs.serial)}` : '';
      const uri   = `usb://${encodeURIComponent(make)}/${encodeURIComponent(model)}${params}`;
      return { uri, make, model };
    }
  } catch { /* nothing more we can do */ }

  return null;
}

/**
 * Walk /sys/bus/usb/devices inside the cups container and locate the entry
 * whose idVendor:idProduct matches `vidpid`.
 * @param {string} vidpid
 * @returns {{ manufacturer:string, product:string, serial:string } | null}
 */
function readSysfsUsbDevice(vidpid) {
  const [vid, pid] = vidpid.toLowerCase().split(':');
  const out = runCups([
    'sh', '-c',
    'for d in /sys/bus/usb/devices/[0-9]*-[0-9]*; do ' +
      '[ -f "$d/idVendor" ] || continue; ' +
      'v=$(cat "$d/idVendor"); p=$(cat "$d/idProduct"); ' +
      `if [ "$v" = "${vid}" ] && [ "$p" = "${pid}" ]; then ` +
        'echo "MFR=$(cat $d/manufacturer 2>/dev/null)"; ' +
        'echo "PRD=$(cat $d/product 2>/dev/null)"; ' +
        'echo "SER=$(cat $d/serial 2>/dev/null)"; ' +
        'break; ' +
      'fi; ' +
    'done',
  ], 5_000);

  const fields = {};
  for (const line of out.split('\n')) {
    const m = /^(MFR|PRD|SER)=(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  if (!fields.MFR && !fields.PRD) return null;
  return {
    manufacturer: fields.MFR || '',
    product:      fields.PRD || 'Printer',
    serial:       fields.SER || '',
  };
}

/** Short, CUPS-friendly make string for a known vendor ID. */
function shortMakeForVid(vidpid) {
  const vid = vidpid.split(':')[0]?.toLowerCase();
  const mk = VID_TO_MAKE[vid];
  if (!mk) return '';
  return mk.charAt(0).toUpperCase() + mk.slice(1);
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
    runCups(['lpadmin', '-p', printerName, '-E', '-v', found.uri,
             '-o', 'printer-is-shared=true'], 30_000);
    runCups(['cupsctl', '--share-printers'], 5_000);
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
 * POST /api/v1/devices/printer/:name/action
 * Body: { action: 'enable'|'disable'|'accept'|'reject'|'cancel-jobs'|'resume' }
 * Performs a CUPS printer management action.
 */
router.post('/printer/:name/action', (req, res) => {
  const { name } = req.params;
  if (!SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name' });
  }
  const { action } = req.body ?? {};
  const allowed = ['enable', 'disable', 'accept', 'reject', 'cancel-jobs', 'resume'];
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${allowed.join(', ')}` });
  }
  try {
    if (action === 'enable' || action === 'resume') {
      runCups(['cupsenable', name], 10_000);
      runCups(['cupsaccept', name], 10_000);
    } else if (action === 'disable') {
      runCups(['cupsdisable', name], 10_000);
    } else if (action === 'accept') {
      runCups(['cupsaccept', name], 10_000);
    } else if (action === 'reject') {
      runCups(['cupsreject', name], 10_000);
    } else if (action === 'cancel-jobs') {
      runCups(['cancel', '-a', name], 10_000);
    }
    res.json({ ok: true, action, name });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 300) });
  }
});

/**
 * GET /api/v1/devices/printer/:name/attributes
 * Returns all settable printer-lpadmin options for this printer.
 * Uses `lpoptions -p <name> -l` to enumerate driver options.
 */
router.get('/printer/:name/attributes', (req, res) => {
  const { name } = req.params;
  if (!SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name' });
  }
  try {
    const out = runCups(['lpoptions', '-p', name, '-l'], 15_000);
    const options = [];
    for (const line of out.split('\n')) {
      // Format: OptionName/Label: *Default value1 value2 ...
      const m = /^([A-Za-z0-9_-]+)\/([^:]*?):\s*(.+)$/.exec(line.trim());
      if (!m) continue;
      const rawValues = m[3].split(/\s+/);
      const values = [];
      let current = null;
      for (const v of rawValues) {
        if (v.startsWith('*')) {
          current = v.slice(1);
          values.push({ value: current, label: current, current: true });
        } else {
          values.push({ value: v, label: v, current: false });
        }
      }
      options.push({ key: m[1], label: m[2] || m[1], values, current });
    }
    res.json({ options });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 300) });
  }
});

/**
 * POST /api/v1/devices/printer/:name/option
 * Body: { key: string, value: string }
 * Sets a printer option via `lpadmin -o key=value`.
 */
router.post('/printer/:name/option', (req, res) => {
  const { name } = req.params;
  if (!SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name' });
  }
  const { key, value } = req.body ?? {};
  // Restrict key/value to safe characters only
  if (!key || !/^[A-Za-z0-9_-]{1,64}$/.test(key)) {
    return res.status(400).json({ error: 'Invalid option key' });
  }
  if (value === undefined || value === null || !/^[A-Za-z0-9_.@, -]{0,128}$/.test(String(value))) {
    return res.status(400).json({ error: 'Invalid option value' });
  }
  try {
    runCups(['lpadmin', '-p', name, '-o', `${key}=${String(value)}`], 10_000);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 300) });
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

/**
 * Run a SANE / scanimage CLI command. In Docker mode this shells into the
 * ps-scanservjs container; in native mode it runs `scanimage` directly.
 */
function runScan(args, timeout = 10_000) {
  const { cmd, args: cmdArgs } = scanCmd(args);
  return run([cmd, ...cmdArgs], timeout);
}

/**
 * Detect whether SANE can currently see a scanner.
 * @returns {boolean}
 */
function saneSeesScanner() {
  try {
    const out = runScan(['scanimage', '-L'], 8_000);
    return /^device\s+'/m.test(out);
  } catch { return false; }
}

/**
 * Detect whether a USB device with scan capability is currently attached.
 * Uses the existing parseUsbDevices() pipeline (sysfs + SANE + CUPS cross-ref).
 * @returns {boolean}
 */
function hasScanCapableUsbDevice() {
  try {
    const list = parseUsbDevices();
    return Array.isArray(list) && list.some(d => d?.capabilities?.scan);
  } catch { return false; }
}

/**
 * List every CUPS print queue name.
 * @returns {string[]}
 */
function listCupsQueues() {
  try {
    const out = runCups(['lpstat', '-p'], 5_000);
    const names = [];
    const re = /^printer (\S+)\s/gm;
    let m;
    while ((m = re.exec(out)) !== null) names.push(m[1]);
    return names;
  } catch { return []; }
}

/**
 * Re-enable any CUPS queues that have flipped to disabled.
 * @param {string[]} queues
 * @param {{enabled:string[], errors:string[]}} result
 */
function recoverDisabledQueues(queues, result) {
  for (const q of queues) {
    try {
      const detail = runCups(['lpstat', '-p', q], 5_000);
      if (/disabled/i.test(detail)) {
        runCups(['cupsenable', q], 5_000);
        result.enabled.push(q);
      }
    } catch (e) {
      result.errors.push(`enable ${q}: ${String(e.message).slice(0, 100)}`);
    }
  }
}

/**
 * Cycle (disable→enable) every CUPS queue so CUPS releases its grip on the
 * USB interface, allowing the SANE backend to claim it.
 * @param {string[]} queues
 * @param {{cycled:string[], errors:string[]}} result
 */
function cycleCupsQueues(queues, result) {
  for (const q of queues) {
    try {
      runCups(['cupsdisable', q], 5_000);
      result.cycled.push(q);
    } catch (e) {
      result.errors.push(`cupsdisable ${q}: ${String(e.message).slice(0, 100)}`);
    }
  }
  // Brief pause so the kernel releases the USB interface.
  const until = Date.now() + 1500;
  while (Date.now() < until) { /* spin */ }
  for (const q of result.cycled) {
    try {
      runCups(['cupsenable', q], 5_000);
    } catch (e) {
      result.errors.push(`cupsenable ${q}: ${String(e.message).slice(0, 100)}`);
    }
  }
}

/**
 * Run device-recovery once.  Returns an object describing what was done so it
 * can be surfaced in logs and the API response.
 *
 * Recovery actions:
 *   1. If a print queue is `disabled`, run cupsenable (queues sometimes flip
 *      to disabled after a USB transient or CUPS restart).
 *   2. If SANE cannot see a scanner but a USB scanner is attached, cycle every
 *      CUPS queue (cupsdisable → cupsenable).  CUPS holds the USB interface
 *      open while a queue is enabled, which blocks the SANE backend; cycling
 *      releases the lock long enough for SANE to claim it.
 *
 * Safe to call repeatedly; no-ops when nothing is wrong.
 *
 * @returns {{ enabled:string[], cycled:string[], scannerOk:boolean, usbScannerPresent:boolean, errors:string[] }}
 */
function runRecovery() {
  const result = {
    enabled: [],
    cycled: [],
    scannerOk: false,
    usbScannerPresent: false,
    errors: [],
  };

  const queues = listCupsQueues();
  recoverDisabledQueues(queues, result);

  result.usbScannerPresent = hasScanCapableUsbDevice();
  result.scannerOk         = saneSeesScanner();

  if (result.usbScannerPresent && !result.scannerOk && queues.length > 0) {
    cycleCupsQueues(queues, result);
    result.scannerOk = saneSeesScanner();
  }

  return result;
}

/**
 * POST /api/v1/devices/recover
 * Manually trigger the recovery routine.  Same logic that the periodic
 * watcher runs in the background.
 */
router.post('/recover', (_req, res) => {
  try {
    const summary = runRecovery();
    res.json({ ok: summary.errors.length === 0, ...summary });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

module.exports = router;
module.exports.runRecovery = runRecovery;
