// Beta test version v1.2.0
'use strict';

/**
 * @module routes/devices
 * @description Manage printers and scanners: list, add (via IPP URI), remove,
 * and test-print.  Printer mutations are performed through the `lpadmin` CLI
 * inside the CUPS container (the portal container itself has no CUPS client).
 *
 * GET    /api/v1/devices            – Combined USB + CUPS device list.
 * GET    /api/v1/devices/drivers    – Search the installed driver/PPD catalogue.
 * POST   /api/v1/devices/printer    – Register a new CUPS printer.
 * POST   /api/v1/devices/printer/auto-add – Auto-detect URI from a USB device.
 * DELETE /api/v1/devices/printer/:name  – Remove a CUPS printer.
 * POST   /api/v1/devices/printer/:name/default – Set as the system default printer.
 * POST   /api/v1/devices/printer/:name/ppd  – Apply an uploaded vendor .ppd file.
 * POST   /api/v1/devices/scanner/default    – Set the portal's preferred default scanner.
 * GET    /api/v1/devices/scanner/network    – List statically-configured network scanners.
 * POST   /api/v1/devices/scanner/network    – Register a network scanner outside the mDNS domain.
 * DELETE /api/v1/devices/scanner/network/:name – Remove a static network scanner entry.
 * POST   /api/v1/devices/printer/:name/test  – Print the CUPS test page.
 * POST   /api/v1/devices/reset      – Remove all CUPS printers + clear wizard.
 */

const router = require('express').Router();
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const multer = require('multer');
const { spawnSync } = require('node:child_process');
const { parseUsbDevices } = require('../services/usb-detect');
const { cupsCmd, scanCmd, isNative } = require('../lib/deployment');
const { getDefaultScanner, setDefaultScanner } = require('../lib/scanner-prefs');
const { listNetworkScanners, addNetworkScanner, removeNetworkScanner } = require('../lib/network-scanner');
const { ensureAwakeForPrinterUri } = require('../lib/device-wake');

/** Allowed characters in a CUPS printer name. */
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validate a network printer/scanner URI. Covers driverless IPP/IPPS as
 * well as the two protocols with no driverless mode — raw JetDirect/9100
 * (`socket://`) and LPD (`lpd://`) — which need an explicit `driver`
 * (see SAFE_DRIVER_ID) to be usable.
 */
const SAFE_NETWORK_URI = /^(?:ipps?|socket|lpd):\/\/[A-Za-z0-9._\-:/]+$/;
/** True for protocols that have no driverless/"everywhere" mode. */
const RAW_URI = /^(?:socket|lpd):\/\//;

/** Validate `usb://Make/Model?...` URIs returned by CUPS lpinfo. */
const SAFE_USB_URI = /^usb:\/\/[A-Za-z0-9%._\-/+]{1,128}\?[A-Za-z0-9%._\-=&]{0,256}$/;

/** USB vid:pid format. */
const SAFE_VIDPID = /^[0-9a-f]{4}:[0-9a-f]{4}$/i;

/** SANE device ids look like `smfp:usb;04e8;344f;SERIAL` — colons, semicolons, dots. */
const SAFE_SCANNER_DEVICE = /^[A-Za-z0-9:;._-]{1,128}$/;

/** Display name for a statically-configured network scanner (used as an airscan.conf key). */
const SAFE_SCANNER_NAME = /^[A-Za-z0-9 _.-]{1,64}$/;
/** eSCL root URL or WSD device URL, e.g. http://192.168.1.102:9095/eSCL */
const SAFE_SCANNER_URL = /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~%\-/]*)?$/;

/**
 * A CUPS driver/PPD identifier as printed by `lpinfo -m`, e.g.
 * `drv:///sample.drv/generic.ppd` or `foomatic-db-ppds:Foomatic/hpcups.ppd`.
 * No spaces or shell metacharacters — args are passed via argv (never a
 * shell), but this still rejects obviously-bogus input early.
 */
const SAFE_DRIVER_ID = /^[A-Za-z0-9:/_.-]{1,256}$/;

/**
 * Read the current CUPS default printer name via `lpstat -d`.
 * @returns {string} empty string if none set or CUPS unreachable.
 */
function getDefaultPrinterName() {
  try {
    const out = runCups(['lpstat', '-d'], 3_000);
    const m = /^system default destination:\s*(\S+)/.exec(out.trim());
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/**
 * Run a command with an explicit arg array (no shell), capturing stdout.
 * @param {string[]} args  First element is the executable; the rest are arguments.
 * @param {number}   [timeout=10000]
 * @param {number}   [maxBuffer=1048576]  spawnSync's stdout/stderr cap (Node
 *   default is 1MB); `lpinfo -m` alone can exceed that with foomatic-db +
 *   gutenprint + hplip installed, so callers with large output raise this.
 * @returns {string}
 */
function run(args, timeout = 10_000, maxBuffer = 1024 * 1024) {
  const result = spawnSync(args[0], args.slice(1), {
    encoding: 'utf8',
    timeout,
    maxBuffer,
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
 * @param {number}   [maxBuffer]  see {@link run}
 */
function runCups(cupsArgs, timeout = 10_000, maxBuffer = undefined) {
  const { cmd, args } = cupsCmd(cupsArgs);
  return run([cmd, ...args], timeout, maxBuffer);
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
 * Whether a real driver/PPD is bound to a CUPS queue, as opposed to a
 * raw/driverless queue that has no channel to report status (paper-out,
 * jam, toner) back to CUPS at all — the exact condition a Samsung ULD
 * printer on this deployment was silently stuck in until it was found and
 * fixed by hand. Checked directly against the PPD file CUPS itself
 * maintains, the same signal `apply-device-quirks.sh`'s reconciliation
 * uses, rather than inferring it from `lpoptions`/`lpadmin` exit codes.
 * @param {string} name
 * @returns {boolean}
 */
function printerHasDriver(name) {
  try {
    runCups(['test', '-s', `/etc/cups/ppd/${name}.ppd`], 3_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * The human-readable driver/model name declared inside a bound PPD (its
 * `*NickName` field), e.g. "Samsung SCX-3400 Series". Null for a
 * driverless queue or one with no PPD bound at all.
 * @param {string} name
 * @returns {string | null}
 */
function printerDriverName(name) {
  try {
    const out = runCups(['grep', '-m1', '^*NickName', `/etc/cups/ppd/${name}.ppd`], 3_000);
    const m = /^\*NickName:\s*"([^"]+)"/.exec(out);
    return m ? m[1] : null;
  } catch {
    return null;
  }
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
    const defaultName = getDefaultPrinterName();
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
        default:      name === defaultName,
        hasDriver:    printerHasDriver(name),
        driverName:   printerDriverName(name),
      });
    }
  } catch { /* CUPS not available */ }

  // --- SANE scanners via cached scanimage -L output ---
  const defaultScanner = getDefaultScanner();
  const scanners = parseSaneScanners(saneRaw).map(s => ({ ...s, default: s.device === defaultScanner }));

  res.json({ usb, printers, scanners });
});

/**
 * Parse `scanimage -L` output into a list of scanner descriptors.
 * Output format:
 *   device `xerox_mfp:libusb:001:002' is a Samsung SCX-3400 Series ...
 * @returns {Array<{device:string, vendor:string, model:string, type:string}>}
 */
// `scanimage -L` is expensive — sane-airscan's eSCL/WS-Discovery probing
// alone routinely takes 8-11s, measured live (a device with both a USB
// and a network/airscan entry is worst-case, since both backends get
// probed). Under Node's single-threaded event loop, every spawnSync call
// this slow blocks *all* other requests for its full duration, not just
// the caller's — confirmed live: a /health request fired 0.5s after a
// /devices request wasn't served until the /devices request's own
// spawnSync finished, ~8s later. With GET /devices polled every 30s from
// the Dashboard, that's a large fraction of the portal's time spent
// completely unresponsive. Caching the raw probe result is the direct
// fix: polling this often doesn't need genuinely fresh data every time.
const SANE_RAW_CACHE_TTL_MS = 15_000;
let _saneRawCache = null; // { ts: number, raw: string }

/**
 * Run `scanimage -L` (cached — see above) and return its combined
 * stdout+stderr. Helpers that need different views of the data (scanner
 * descriptors / USB bus:device pairs) parse this raw output instead of
 * re-invoking the CLI.
 * @returns {string}
 */
function collectSaneRaw() {
  const now = Date.now();
  if (_saneRawCache && (now - _saneRawCache.ts) < SANE_RAW_CACHE_TTL_MS) {
    return _saneRawCache.raw;
  }
  try {
    const { cmd, args } = scanCmd(['scanimage', '-L']);
    // Generous timeout — the command itself has been observed taking
    // ~10.7s; the previous 10_000ms bound was shorter than that, meaning
    // spawnSync's SIGTERM could truncate mid-flush rather than the
    // command ever completing cleanly.
    const r = spawnSync(cmd, args, { timeout: 20_000, encoding: 'utf8' });
    const raw = (r.stdout || '') + (r.stderr || '');
    _saneRawCache = { ts: now, raw };
    return raw;
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

// `lpinfo -v` does live backend/device discovery (USB + network) on every
// call — measured at ~2s on this host — same blocking-the-whole-server
// problem as scanimage -L (see collectSaneRaw's comment), just smaller.
// Cached for the same reason: GET /devices calls this on every poll, and
// findCupsUriForVidPid() calls it again for the same request via a
// different path.
const LPINFO_V_CACHE_TTL_MS = 15_000;
let _lpinfoVCache = null; // { ts: number, raw: string }

/**
 * Run `lpinfo -v` (cached) and return its raw stdout.
 * @returns {string}
 */
function collectLpinfoV() {
  const now = Date.now();
  if (_lpinfoVCache && (now - _lpinfoVCache.ts) < LPINFO_V_CACHE_TTL_MS) {
    return _lpinfoVCache.raw;
  }
  const raw = runCups(['lpinfo', '-v'], 8_000);
  _lpinfoVCache = { ts: now, raw };
  return raw;
}

/**
 * Collect manufacturer names from CUPS-detected USB printers (`lpinfo -v`).
 * @returns {string[]} lowercased makes
 */
function collectCupsPrinterMakes() {
  try {
    const out = collectLpinfoV();
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
    const out = collectLpinfoV();
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
 * Body: { name: string, uri: string, driver?: string }
 *
 * Registers a new CUPS printer using lpadmin.
 *  - `driver` (optional), when given, must be a driver id from
 *    GET /api/v1/devices/drivers (i.e. an `lpinfo -m` entry) or a path
 *    applied via POST /printer/:name/ppd afterwards — used verbatim as
 *    `-m <driver>`, overriding the defaults below.
 *  - ipp(s):// with no driver → `-m everywhere` (driverless).
 *  - socket:// / lpd:// (no driverless mode exists for either) with no
 *    driver → a generic PostScript bootstrap driver; pick a real one via
 *    `driver` or refine afterwards with POST /printer/:name/ppd.
 *  - usb:// with no driver → CUPS auto-selects from installed PPDs.
 */
router.post('/printer', (req, res) => {
  const { name, uri, driver } = req.body ?? {};

  if (!name || !SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name (alphanumeric, up to 64 chars)' });
  }
  const isNetwork = SAFE_NETWORK_URI.test(uri || '');
  const isUsb = SAFE_USB_URI.test(uri || '');
  if (!uri || (!isNetwork && !isUsb)) {
    return res.status(400).json({
      error: 'Invalid URI (must start with ipp://, ipps://, socket://, lpd:// or usb://)',
    });
  }
  const safeDriver = (typeof driver === 'string' && SAFE_DRIVER_ID.test(driver)) ? driver : '';

  try {
    const adminArgs = ['lpadmin', '-p', name, '-E', '-v', uri];
    let appliedDriver;
    if (safeDriver) {
      adminArgs.push('-m', safeDriver);
      appliedDriver = safeDriver;
    } else if (RAW_URI.test(uri)) {
      // socket:// / lpd:// have no driverless mode. Bootstrap with the
      // generic PostScript driver that ships in cups-filters' sample.drv;
      // the caller should refine this via `driver` or POST .../ppd.
      adminArgs.push('-m', 'drv:///sample.drv/generic.ppd');
      appliedDriver = 'drv:///sample.drv/generic.ppd';
    } else if (isNetwork) {
      adminArgs.push('-m', 'everywhere');
      appliedDriver = 'everywhere';
    } else {
      appliedDriver = 'auto (CUPS-selected)';
    }
    runCups(adminArgs, 30_000);
    // Only claim the default slot if nothing is set yet — an explicit user
    // choice (via /printer/:name/default) must never be silently overridden
    // by adding a second, third, etc. printer.
    if (!getDefaultPrinterName()) runCups(['lpadmin', '-d', name], 5_000);
    res.json({ ok: true, name, uri, driver: appliedDriver });
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
    if (!getDefaultPrinterName()) runCups(['lpadmin', '-d', printerName], 5_000);
    res.json({ ok: true, name: printerName, uri: found.uri, make: found.make, model: found.model });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

// Cache of `lpinfo -m` (the installed driver/PPD catalogue — foomatic-db,
// gutenprint and hplip alone list several thousand entries). The call takes
// 1-3s, so results are cached briefly rather than re-run on every keystroke
// of a search box.
let _driverCatalog = null; // { ts: number, entries: {id:string, description:string}[] }
const DRIVER_CATALOG_TTL_MS = 10 * 60 * 1000;

/** @returns {{id:string, description:string}[]} */
function getDriverCatalog() {
  const now = Date.now();
  if (_driverCatalog && (now - _driverCatalog.ts) < DRIVER_CATALOG_TTL_MS) {
    return _driverCatalog.entries;
  }
  const out = runCups(['lpinfo', '-m'], 25_000, 16 * 1024 * 1024);
  const entries = [];
  for (const line of out.split('\n')) {
    const m = /^(\S+)\s+(.+)$/.exec(line.trim());
    if (m) entries.push({ id: m[1], description: m[2] });
  }
  _driverCatalog = { ts: now, entries };
  return entries;
}

/**
 * GET /api/v1/devices/drivers?q=<search>
 * Search the locally-installed driver/PPD catalogue (foomatic-db +
 * gutenprint + hplip, already pre-installed on every deploy, plus
 * whatever per-device packages the quirks catalogue has added). Used by
 * the "Add Network Printer" and "Change Driver" UI to let a user pick a
 * real driver instead of only the driverless "everywhere" model — needed
 * for any printer that doesn't support IPP Everywhere/AirPrint (older
 * network printers, socket:// / lpd:// raw queues).
 */
router.get('/drivers', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  try {
    const all = getDriverCatalog();
    const filtered = q
      ? all.filter(e => e.description.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
      : all;
    res.json({ drivers: filtered.slice(0, 50), total: filtered.length });
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
 * POST /api/v1/devices/printer/:name/default
 * Sets the named CUPS printer as the system default (`lpadmin -d`).
 */
router.post('/printer/:name/default', (req, res) => {
  const { name } = req.params;
  if (!SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name' });
  }
  try {
    runCups(['lpadmin', '-d', name], 5_000);
    res.json({ ok: true, default: name });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

/**
 * POST /api/v1/devices/scanner/default
 * Body: { device: string }
 * Persists which SANE device id `/api/v1/scans/context` should prefer.
 * SANE has no native "default device" concept, so this is portal-side state.
 */
router.post('/scanner/default', (req, res) => {
  const { device } = req.body ?? {};
  if (!device || !SAFE_SCANNER_DEVICE.test(device)) {
    return res.status(400).json({ error: 'Invalid scanner device id' });
  }
  try {
    setDefaultScanner(device);
    res.json({ ok: true, default: device });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

/**
 * GET /api/v1/devices/scanner/network
 * Lists statically-configured network scanners (sane-airscan's
 * airscan.conf [devices] section) — devices outside the mDNS broadcast
 * domain that auto-discovery can't find on its own.
 */
router.get('/scanner/network', (_req, res) => {
  if (!isNative()) {
    return res.status(400).json({ error: 'Only available in native deployment mode' });
  }
  try {
    res.json({ scanners: listNetworkScanners() });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

/**
 * POST /api/v1/devices/scanner/network
 * Body: { name: string, url: string, protocol: 'eSCL' | 'WSD' }
 * Registers (or updates) a static network scanner entry, for a scanner
 * that mDNS auto-discovery can't reach (different subnet/VLAN, or
 * unreliable multicast). sane-airscan re-reads its config on every
 * `scanimage` invocation, so no service restart is needed.
 *
 * Note: sane-airscan lists a statically-configured device unconditionally
 * — it doesn't probe reachability at listing time (that would make every
 * `scanimage -L` call as slow as its slowest configured device), so there
 * is no reliable "is it actually reachable" signal to return here. An
 * unreachable URL will still show up in the device list and only fail
 * when a scan is actually attempted.
 */
router.post('/scanner/network', (req, res) => {
  if (!isNative()) {
    return res.status(400).json({ error: 'Only available in native deployment mode' });
  }
  const { name, url, protocol } = req.body ?? {};
  if (!name || !SAFE_SCANNER_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid name (letters, numbers, spaces, up to 64 chars)' });
  }
  if (!url || !SAFE_SCANNER_URL.test(url)) {
    return res.status(400).json({ error: 'Invalid url (must be http:// or https://)' });
  }
  const proto = protocol === 'WSD' ? 'WSD' : 'eSCL';
  try {
    addNetworkScanner(name, url, proto);
    res.json({ ok: true, name, url, protocol: proto });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 200) });
  }
});

/**
 * DELETE /api/v1/devices/scanner/network/:name
 */
router.delete('/scanner/network/:name', (req, res) => {
  if (!isNative()) {
    return res.status(400).json({ error: 'Only available in native deployment mode' });
  }
  const { name } = req.params;
  if (!SAFE_SCANNER_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  try {
    const removed = removeNetworkScanner(name);
    res.json({ ok: removed });
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

const ppdUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `ps-ppd-${Date.now()}-${Math.random().toString(36).slice(2)}.ppd`),
  }),
  limits: { fileSize: 512 * 1024 }, // PPDs are plain-text and small; 512KB is generous
  fileFilter: (_req, file, cb) => cb(null, /\.ppd$/i.test(file.originalname)),
});

/**
 * Make a locally-uploaded file available to the CUPS `lpadmin -P` command.
 * Native mode: CUPS runs on the same host, the path already works.
 * Docker mode: `lpadmin` runs inside the ps-cups container via `docker exec`,
 * so the file has to be copied across the container boundary first.
 * @param {string} localPath
 * @returns {string} path usable in the `runCups(...)` argv
 */
function stageForCups(localPath) {
  if (isNative()) return localPath;
  const dest = `/tmp/${path.basename(localPath)}`;
  const r = spawnSync('docker', ['cp', localPath, `ps-cups:${dest}`], { timeout: 10_000 });
  if (r.status !== 0) throw new Error('Failed to copy PPD into the cups container');
  return dest;
}

/** Remove the staged copy inside the cups container, best-effort. */
function unstageFromCups(localPath) {
  if (isNative()) return;
  spawnSync('docker', ['exec', 'ps-cups', 'rm', '-f', `/tmp/${path.basename(localPath)}`], { timeout: 5_000 });
}

/**
 * POST /api/v1/devices/printer/:name/ppd
 * Multipart upload (`ppd` field) of a vendor-supplied .ppd file, applied
 * to an existing printer via `lpadmin -P`. This is the safety-conscious
 * counterpart to apt-installed drivers: PPDs are plain-text configuration
 * files (not executables), so a user who has downloaded one from a
 * vendor's site can apply it without needing shell/CUPS-admin access —
 * covering printers with no Debian-packaged driver and no driverless mode,
 * without the portal ever fetching or running untrusted vendor binaries
 * itself.
 */
router.post('/printer/:name/ppd', ppdUpload.single('ppd'), (req, res) => {
  const { name } = req.params;
  const cleanup = () => { if (req.file) fs.unlink(req.file.path, () => {}); };

  if (!SAFE_NAME.test(name)) {
    cleanup();
    return res.status(400).json({ error: 'Invalid printer name' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No PPD file uploaded (field "ppd", .ppd extension, max 512KB)' });
  }

  try {
    const head = fs.readFileSync(req.file.path, 'utf8').slice(0, 32);
    if (!head.startsWith('*PPD-Adobe:')) {
      return res.status(400).json({ error: 'Not a valid PPD file (missing *PPD-Adobe: header)' });
    }
    const cupsPath = stageForCups(req.file.path);
    try {
      runCups(['lpadmin', '-p', name, '-P', cupsPath], 20_000);
    } finally {
      unstageFromCups(req.file.path);
    }
    res.json({ ok: true, name, message: 'Driver updated from uploaded PPD' });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 300) });
  } finally {
    cleanup();
  }
});

/**
 * POST /api/v1/devices/printer/:name/test
 * Prints the CUPS test page to the named printer.
 */
router.post('/printer/:name/test', async (req, res) => {
  const { name } = req.params;
  if (!SAFE_NAME.test(name)) {
    return res.status(400).json({ error: 'Invalid printer name' });
  }
  try {
    await ensureAwakeForPrinterUri(getPrinterUri(name));
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
