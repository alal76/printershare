// Beta test version v1.2.0
'use strict';

/**
 * @module routes/wizard
 * @description Setup-wizard REST endpoints.
 *
 * GET  /api/v1/wizard/state       – Returns the persisted wizard state
 * POST /api/v1/wizard/state       – Advances the wizard step and merges config
 * GET  /api/v1/wizard/prereqs     – Checks platform prerequisites (docker compose / systemd) + rclone
 * POST /api/v1/wizard/rclone-auth – Creates an rclone remote from a pasted token or S3 keys
 * POST /api/v1/wizard/build       – Persists .env and (Docker mode) brings the stack up via SSE
 * POST /api/v1/wizard/reset       – Clears persisted state
 */

const router = require('express').Router();
const fs     = require('node:fs');
const path   = require('node:path');
const { spawn, execSync, spawnSync } = require('node:child_process');
const { sanitizePatch } = require('./settings');
const { isNative, cupsCmd, scanCmd } = require('../lib/deployment');
const quirks = require('../lib/device-quirks');

/** Allowed characters in a printer/scanner make field. */
const SAFE_MAKE = /^[A-Za-z0-9 _-]{1,64}$/;

const DATA_DIR   = process.env.PORTAL_DATA_DIR || '/app/data';
const STATE_FILE = path.join(DATA_DIR, 'wizard-state.json');

/**
 * Load the wizard state from disk.
 * @returns {{ step: number, completed: boolean, config: Record<string,string> }}
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch { /* ignore corrupt state */ }
  return { step: 0, completed: false, config: {} };
}

/**
 * Persist the wizard state to disk.
 * @param {{ step: number, completed: boolean, config: Record<string,string> }} state
 */
function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// GET /api/v1/wizard/state
router.get('/state', (_req, res) => {
  res.json(loadState());
});

// POST /api/v1/wizard/state — advance wizard step
router.post('/state', (req, res) => {
  const { step, data } = req.body;
  if (typeof step !== 'number') {
    return res.status(400).json({ error: 'step must be a number' });
  }
  const state = loadState();
  state.step   = step;
  state.config = { ...state.config, ...data };
  saveState(state);
  res.json({ ok: true, state });
});

/**
 * Merge key=value pairs from config object into the .env file.
 * Only keys that pass sanitizePatch validation are written.
 */
function mergeEnv(dotenvPath, config) {
  const clean = sanitizePatch(config);
  let existing = '';
  try { existing = fs.readFileSync(dotenvPath, 'utf8'); } catch { /* new file */ }
  const lines = existing.split('\n');
  for (const [k, v] of Object.entries(clean)) {
    const idx = lines.findIndex(l => l.startsWith(`${k}=`));
    const line = `${k}=${String(v)}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  fs.writeFileSync(dotenvPath, lines.filter(Boolean).join('\n') + '\n');
}

function sendSse(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
}

/**
 * Build a spawn-friendly argv pair for running a shell command "inside" a
 * service. In Docker mode this uses `docker exec <container>`; in native
 * mode the argv is run directly on the host.
 * @param {string}   container  e.g. 'ps-cups'
 * @param {string[]} args       e.g. ['apt-get', 'update', '-qq']
 * @returns {{ cmd: string, args: string[] }}
 */
function execIn(container, args) {
  if (isNative()) return { cmd: args[0], args: args.slice(1) };
  return { cmd: 'docker', args: ['exec', container, ...args] };
}

// GET /api/v1/wizard/prereqs — check required tools are available
router.get('/prereqs', (_req, res) => {
  const result = {};

  if (isNative()) {
    // Native LXC / bare-metal: check systemd + cups unit instead of docker.
    try {
      const ver = execSync('systemctl --version 2>&1', { timeout: 3000, encoding: 'utf8' })
        .trim().split('\n')[0];
      const cupsActive = execSync('systemctl is-active cups 2>&1', { timeout: 3000, encoding: 'utf8' }).trim();
      const ok = cupsActive === 'active';
      result.dockerCompose = {
        ok,
        detail: ok ? `${ver} (native, cups active)` : `${ver} (cups: ${cupsActive})`,
      };
    } catch (e) {
      result.dockerCompose = { ok: false, detail: `systemd unavailable: ${String(e.message).slice(0, 200)}` };
    }
  } else {
    try {
      const ver = execSync('docker compose version 2>&1', { timeout: 5000, encoding: 'utf8' }).trim();
      result.dockerCompose = { ok: true, detail: ver.split('\n')[0] };
    } catch {
      result.dockerCompose = { ok: false, detail: 'docker compose plugin not found' };
    }
  }

  try {
    const ver = execSync('rclone version 2>&1', { timeout: 5000, encoding: 'utf8' })
      .trim().split('\n')[0];
    result.rclone = { ok: true, detail: ver };
  } catch {
    result.rclone = { ok: false, detail: 'rclone not installed' };
  }

  res.json(result);
});

// ─── Driver package maps ──────────────────────────────────────────────────
// Packages that are NOT pre-installed in the cups/scanservjs images but may be
// required for specific devices.  Pre-installed: hplip, gutenprint, foomatic-db.

/** Extra apt packages needed in the CUPS container per printer make (lowercase). */
const PRINT_PKG_MAP = {
  epson:   ['printer-driver-escpr'],
  brother: ['printer-driver-brlaser'],
  samsung: ['printer-driver-splix'],
  lexmark: ['printer-driver-foo2zjs'],
  // hp, canon, ricoh, xerox — covered by pre-installed packages
};

/** Extra apt packages needed in the scanservjs container per scanner make (lowercase). */
const SCAN_PKG_MAP = {
  hp:      ['libsane-hpaio'],
  epson:   ['libsane-epson2'],
  brother: ['libsane-hpaio'],
  // canon — sane-airscan already installed; escl covered
};

/**
 * Merge per-device quirks (data/device-quirks.json, by VID:PID) with the
 * make-level fallback map above. The quirks DB is the authoritative source
 * for newly-supported devices; the legacy maps cover callers that only
 * know the brand name and not the USB id.
 *
 * @param {string} make
 * @param {'print' | 'scan'} cap
 * @param {string} [vidpid]
 */
function packagesForCap(make, cap, vidpid) {
  const fromQuirks = quirks.packagesFor(vidpid || '', make || '', [cap]);
  const fromMap = (cap === 'print' ? PRINT_PKG_MAP : SCAN_PKG_MAP)[(make || '').toLowerCase()] || [];
  return [...new Set([...fromQuirks, ...fromMap])];
}

function printPackages(make, vidpid) {
  return packagesForCap(make, 'print', vidpid);
}
function scanPackages(make, vidpid) {
  return packagesForCap(make, 'scan', vidpid);
}

// GET /api/v1/wizard/scan-devices — list SANE-visible scanners via scanimage -L
router.get('/scan-devices', (_req, res) => {
  try {
    const { cmd, args } = scanCmd(['scanimage', '-L']);
    const r = spawnSync(cmd, args, { timeout: 20000, encoding: 'utf8' });
    const raw = ((r.stdout || '') + (r.stderr || '')).trim();
    // Each line: device `backend:path' is a <description>
    const scanners = [];
    for (const line of raw.split('\n')) {
      const m = line.match(/^device [`']([^`']+)[`'] is a (.+)$/);
      if (m) scanners.push({ device: m[1], description: m[2].trim() });
    }
    res.json({ scanners, raw });
  } catch (err) {
    res.json({ scanners: [], raw: String(err.message) });
  }
});

/**
 * GET /api/v1/wizard/discover-network
 * Discover network-connected printers and scanners via mDNS (avahi-browse).
 * Returns a list of devices with their IPP URIs so the wizard can present
 * them for one-click adoption — no IP address entry required.
 *
 * Supports both USB-attached devices exposed over the network (IPP-over-USB
 * via ipp-usb / AirPrint) and standalone network printers/scanners.
 *
 * Gracefully returns an empty list if avahi-browse is not installed.
 */
router.get('/discover-network', (_req, res) => {
  const devices = [];

  // avahi-browse in parseable (-p) + terminate-after-browse (-t) + resolve (-r) mode.
  // Service types: _ipp._tcp  _ipps._tcp (printers), _uscan._tcp  _uscans._tcp (scanners)
  const avahiArgs = [
    '-r', '-t', '-p',
    '_ipp._tcp,_ipps._tcp,_uscan._tcp,_uscans._tcp',
  ];

  try {
    const r = spawnSync('avahi-browse', avahiArgs, {
      timeout: 8000,
      encoding: 'utf8',
    });
    const out = (r.stdout || '') + (r.stderr || '');

    // Parseable output line format (= means resolved):
    // =;eth0;IPv4;HP LaserJet M404n;_ipp._tcp;local;hp.local;192.168.1.5;631;...
    for (const line of out.split('\n')) {
      if (!line.startsWith('=')) continue;
      const parts = line.split(';');
      if (parts.length < 9) continue;
      const [, , proto, name, service, , hostname, address, portStr] = parts;
      if (!address || address === '0.0.0.0' || address === '::1') continue;

      const port    = Number.parseInt(portStr, 10) || 631;
      const isSecure = service.includes('ipps') || service.includes('uscans');
      const isScanner = service.includes('uscan');
      const scheme  = isSecure ? 'ipps' : 'ipp';
      // Standard CUPS IPP path; most devices respond here for driverless.
      const uri     = `${scheme}://${address}:${port}/ipp/print`;
      const kind    = isScanner ? 'scanner' : 'printer';

      devices.push({
        name:     decodeURIComponent(name.replaceAll(String.raw`\032`, ' ')),
        service,
        hostname: hostname.replace(/\.$/, ''),  // strip trailing dot
        address,
        port,
        proto,
        uri,
        kind,
        source:   'mdns',
      });
    }
  } catch {
    /* avahi-browse not available — return empty list */
  }

  // Deduplicate by address+port (same device may advertise multiple service types)
  const seen = new Set();
  const unique = devices.filter(d => {
    const key = `${d.address}:${d.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json({ devices: unique });
});

/**
 * POST /api/v1/wizard/adopt-network-device
 * Register a network printer (IPP/IPPS) with CUPS using driverless
 * IPP Everywhere — works for any modern printer advertising _ipp._tcp.
 * Body: { name: string, uri: string }
 *
 * After adding to CUPS, the printer is automatically available via:
 *  - IPP share (CUPS re-advertises it via Bonjour)
 *  - Samba share (the scans share is pre-configured at install time)
 *  - The portal print queue
 *
 * Returns { ok, name, uri, message }.
 */
const SAFE_WIZARD_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_WIZARD_IPP  = /^ipps?:\/\/[A-Za-z0-9._\-:/]+$/;

router.post('/adopt-network-device', (req, res) => {
  const { name, uri } = req.body || {};

  if (!name || !SAFE_WIZARD_NAME.test(name)) {
    return res.status(400).json({ error: 'name must be 1-64 alphanumeric/underscore/hyphen characters' });
  }
  if (!uri || !SAFE_WIZARD_IPP.test(uri)) {
    return res.status(400).json({ error: 'uri must be a valid ipp:// or ipps:// URI' });
  }

  const { cmd: cupsExec, args: cupsExecArgs } = execIn('ps-cups', [
    'lpadmin', '-p', name, '-E', '-v', uri,
    '-m', 'everywhere',
    '-o', 'printer-is-shared=true',
  ]);

  const r = spawnSync(cupsExec, cupsExecArgs, { timeout: 20_000, encoding: 'utf8' });
  if (r.status !== 0) {
    return res.status(500).json({
      error: 'lpadmin failed',
      detail: (r.stderr || r.stdout || `exit ${r.status}`).slice(0, 400),
    });
  }

  // Enable + accept the queue so it can receive jobs immediately
  const { cmd: ena, args: enaArgs } = execIn('ps-cups', ['cupsenable', name]);
  spawnSync(ena, enaArgs, { timeout: 5_000 });
  const { cmd: acc, args: accArgs } = execIn('ps-cups', ['cupsaccept', name]);
  spawnSync(acc, accArgs, { timeout: 5_000 });

  res.json({ ok: true, name, uri, message: `${name} added via IPP Everywhere (driverless)` });
});

// GET /api/v1/wizard/quirks — return per-device quirks record (driver hints,
// SANE backend, blacklists, ipp-usb/AirSane compatibility, notes). Used by
// the wizard UI to surface "this device needs the ULD driver" hints and by
// install scripts to consult sane_blacklist without hard-coding model logic.
router.get('/quirks', (req, res) => {
  const { vidpid = '', make = '' } = req.query;
  res.json(quirks.lookup(String(vidpid), String(make)));
});

// POST /api/v1/wizard/apply-quirks — re-run scripts/apply-device-quirks.sh
// against the connected USB devices and return the list of packages it
// suggests installing + any blacklist actions it took. Native-mode only;
// requires the portal to run as root (it does, by default, under systemd).
//
// Use this from the UI after the user plugs in a new device, so SANE
// backends are reconciled without rebooting or re-running the installer.
router.post('/apply-quirks', (_req, res) => {
  if (!isNative()) {
    return res.status(400).json({ error: 'apply-quirks is only available in native deployment mode' });
  }
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'apply-device-quirks.sh');
  if (!fs.existsSync(script)) {
    return res.status(500).json({ error: `helper script missing at ${script}` });
  }
  const r = spawnSync('bash', [script], { timeout: 30000, encoding: 'utf8' });
  const packages = (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
  res.json({
    ok:       r.status === 0,
    packages,
    log:      (r.stderr || '').trim(),
    exitCode: r.status,
  });
});

// GET /api/v1/wizard/driver-check — check printer + scanner driver availability
// Query params: vidpid, make, print=1, scan=1
router.get('/driver-check', (req, res) => {
  const { vidpid = '', make = '', print: wantPrint = '0', scan: wantScan = '0' } = req.query;
  const result = { vidpid, make, print: null, scan: null };

  if (wantPrint === '1') {
    result.print = checkPrintDriver(make, vidpid);
  }

  if (wantScan === '1') {
    result.scan = checkScanDriver(make, vidpid);
  }

  result.quirks = quirks.lookup(vidpid, make);

  res.json(result);
});

function checkPrintDriver(make, vidpid) {
  if (make && !SAFE_MAKE.test(make)) {
    return { ok: false, packages: [], detail: 'Invalid make value' };
  }
  try {
    const { cmd, args } = cupsCmd(['lpinfo', '-m']);
    const result  = spawnSync(cmd, args, { timeout: 20000, encoding: 'utf8' });
    const output  = ((result.stdout || '') + (result.stderr || '')).split('\n');
    const lines   = make
      ? output.filter(l => l.toLowerCase().includes(make.toLowerCase())).slice(0, 5)
      : output.slice(0, 5);
    const hasPpd  = lines.some(l => l.trim().length > 0);
    const missing = printPackages(make, vidpid);
    let detail;
    if (hasPpd) detail = `PPD found for ${make} in CUPS`;
    else if (missing.length) detail = `No PPD yet — will install: ${missing.join(', ')}`;
    else detail = `No dedicated PPD for ${make} — generic driver will be used`;
    return { ok: hasPpd || missing.length === 0, packages: missing, detail };
  } catch (e) {
    return { ok: false, packages: [], detail: String(e.message) };
  }
}

function checkScanDriver(make, vidpid) {
  try {
    const { cmd, args } = scanCmd(['scanimage', '-L']);
    const r = spawnSync(cmd, args, { timeout: 15000, encoding: 'utf8' });
    const saneList = (r.stdout || '') + (r.stderr || '');
    const found    = saneList.toLowerCase().includes(make.toLowerCase()) ||
                     (vidpid && saneList.includes(vidpid.split(':')[0]));
    const missing  = scanPackages(make, vidpid);
    let detail;
    if (found) detail = 'Scanner found by SANE';
    else if (missing.length) detail = `Scanner not visible to SANE — will install: ${missing.join(', ')}`;
    else detail = 'Scanner not visible yet — try reconnecting USB after setup';
    return { ok: found || missing.length === 0, packages: missing, detail };
  } catch (e) {
    return { ok: false, packages: [], detail: String(e.message) };
  }
}

// POST /api/v1/wizard/driver-install — SSE streaming apt-get driver installation
router.post('/driver-install', (req, res) => {
  const { make = '', capabilities = [] } = req.body || {};
  const caps = Array.isArray(capabilities) ? capabilities : String(capabilities).split(',');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Virtual printer path — install packages then create CUPS queue
  if (make === 'Virtual-PDF' || make === 'Virtual-XPS') {
    return installVirtualPrinter(make, res);
  }

  const tasks = [];
  const printPkgs = caps.includes('print') ? printPackages(make, req.body?.vidpid) : [];
  const scanPkgs  = caps.includes('scan')  ? scanPackages(make, req.body?.vidpid)  : [];

  if (printPkgs.length) {
    tasks.push({ container: 'ps-cups',       packages: printPkgs, label: 'print driver' });
  }
  if (scanPkgs.length) {
    tasks.push({ container: 'ps-scanservjs', packages: scanPkgs,  label: 'scan driver'  });
  }

  if (!tasks.length) {
    sendSse(res, 'log', 'All required drivers are already present — nothing to install.');
    sendSse(res, 'complete', 'No installations needed');
    res.end();
    return;
  }

  // Persist print packages into wizard config so Review & Build can bake them into the image
  persistExtraPackages(printPkgs);

  // Run apt-get update once, then install each task in sequence
  const updateLabel = isNative() ? 'host' : 'ps-cups';
  sendSse(res, 'log', `==> Updating package lists (${updateLabel})...`);
  const upd = execIn('ps-cups', ['apt-get', 'update', '-qq']);
  const update = spawn(upd.cmd, upd.args, {
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });
  update.on('error', () => runTasks(tasks, res));  // non-fatal
  update.on('close', () => runTasks(tasks, res));

  req.on('close', () => update.kill());
});

/**
 * Install a virtual (software-only) CUPS printer — either PDF or XPS.
 *
 * PDF:  installs cups-pdf, registers a "Virtual-PDF" CUPS queue backed by cups-pdf.
 * XPS:  installs cups-pdf + ghostscript, registers a "Virtual-XPS" CUPS queue;
 *       a PostProcessing hook converts each PDF output to XPS via ghostscript xpswrite.
 */
function installVirtualPrinter(make, res) {
  const isPdf    = make === 'Virtual-PDF';
  const queueName = isPdf ? 'Virtual-PDF' : 'Virtual-XPS';
  const packages  = isPdf ? ['printer-driver-cups-pdf'] : ['printer-driver-cups-pdf', 'ghostscript'];
  const label     = isPdf ? 'PDF' : 'XPS';

  const target = isNative() ? 'host' : 'ps-cups';
  sendSse(res, 'log', `==> Installing ${label} virtual printer packages (${packages.join(', ')}) on ${target}...`);

  const upd = execIn('ps-cups', ['apt-get', 'update', '-qq']);
  const update = spawn(upd.cmd, upd.args, {
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });
  update.on('error', () => doInstallVirtual(packages, queueName, isPdf, res));
  update.on('close', () => doInstallVirtual(packages, queueName, isPdf, res));
}

function doInstallVirtual(packages, queueName, isPdf, res) {
  const inst = execIn('ps-cups', [
    'apt-get', 'install', '-y', '--no-install-recommends', ...packages,
  ]);
  const install = spawn(inst.cmd, inst.args,
    { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });

  install.stdout.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));
  install.stderr.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));
  install.on('error', err => { sendSse(res, 'error', `Install error: ${err.message}`); res.end(); });
  install.on('close', code => {
    if (code !== 0) {
      sendSse(res, 'error', `apt-get exited ${code} — check container logs`);
      res.end();
      return;
    }
    sendSse(res, 'log', `✓ Packages installed`);
    if (isPdf) {
      setupPdfQueue(queueName, res);
    } else {
      setupXpsQueue(queueName, res);
    }
  });
}

function setupPdfQueue(queueName, res) {
  sendSse(res, 'log', `==> Registering ${queueName} CUPS queue...`);
  const ad = execIn('ps-cups', [
    'lpadmin', '-p', queueName, '-E', '-v', 'cups-pdf:/', '-P', '/usr/share/ppd/cups-pdf/CUPS-PDF_opt.ppd',
    '-o', 'printer-is-shared=true',
  ]);
  const lpadmin = spawn(ad.cmd, ad.args);
  lpadmin.stderr.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));
  lpadmin.on('close', code => {
    if (code !== 0) { sendSse(res, 'error', `lpadmin exited ${code}`); res.end(); return; }
    sendSse(res, 'log', `✓ ${queueName} CUPS queue created — output: /var/spool/cups-pdf/ANONYMOUS/`);
    sendSse(res, 'complete', `${queueName} printer ready`);
    res.end();
  });
}

function setupXpsQueue(queueName, res) {
  sendSse(res, 'log', `==> Configuring XPS output directory and post-processing hook...`);

  // Write a PostProcessing script that converts PDF→XPS for the Virtual-XPS queue
  const postScript = [
    '#!/bin/sh',
    '# Called by cups-pdf after each job. $1=PDF path, $CUPS_PRINTER=queue name',
    `[ "$CUPS_PRINTER" = "${queueName}" ] || exit 0`,
    'OUTDIR=/var/spool/xps-printer/ANONYMOUS',
    'mkdir -p "$OUTDIR"',
    'OUT="$OUTDIR/$(basename "${1%.pdf}").xps"',
    'gs -dNOPAUSE -dBATCH -sDEVICE=xpswrite -sOutputFile="$OUT" "$1" 2>/dev/null && rm -f "$1"',
  ].join('\n');

  const ws = execIn('ps-cups', [
    'sh', '-c',
    `printf '%s\n' ${JSON.stringify(postScript)} > /usr/local/bin/cups-pdf-xps.sh && chmod +x /usr/local/bin/cups-pdf-xps.sh`,
  ]);
  const writeScript = spawn(ws.cmd, ws.args);

  writeScript.on('close', () => {
    // Add PostProcessing line to cups-pdf.conf (idempotent grep+append)
    const pc = execIn('ps-cups', [
      'sh', '-c',
      'grep -q "^PostProcessing" /etc/cups/cups-pdf.conf 2>/dev/null' +
      ' || echo "PostProcessing /usr/local/bin/cups-pdf-xps.sh" >> /etc/cups/cups-pdf.conf',
    ]);
    const patchConf = spawn(pc.cmd, pc.args);
    patchConf.on('close', () => setupPdfQueue(queueName, res));
  });
}

function runTasks(tasks, res) {
  let idx = 0;
  function next() {
    if (idx >= tasks.length) {
      sendSse(res, 'complete', 'Driver installation complete');
      res.end();
      return;
    }
    const { container, packages, label } = tasks[idx++];
    const target = isNative() ? 'host' : container;
    sendSse(res, 'log', `==> Installing ${label} (${packages.join(' ')}) on ${target}...`);
    const inst = execIn(container, [
      'apt-get', 'install', '-y', '--no-install-recommends', ...packages,
    ]);
    const child = spawn(inst.cmd, inst.args,
      { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });
    child.stdout.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));
    child.stderr.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));
    child.on('error', err => {
      sendSse(res, 'error', `Spawn error: ${err.message}`);
      res.end();
    });
    child.on('close', code => {
      if (code !== 0) {
        sendSse(res, 'error', `apt-get exited ${code} — check container logs`);
        res.end();
        return;
      }
      sendSse(res, 'log', `✓ ${label} installed`);
      next();
    });
  }
  next();
}

// Persist installed packages into wizard state so Review & Build can bake them in
function persistExtraPackages(printPkgs) {
  if (!printPkgs.length) return;
  try {
    const state = loadState();
    const existing = (state.config.CUPS_EXTRA_PACKAGES || '').trim();
    const merged   = [...new Set([...existing.split(' ').filter(Boolean), ...printPkgs])].join(' ');
    state.config.CUPS_EXTRA_PACKAGES = merged;
    saveState(state);
  } catch { /* non-fatal */ }
}

/**
 * Map wizard provider names to rclone backend types and remote names.
 */
const PROVIDER_TYPE = { dropbox: 'dropbox', gdrive: 'drive', onedrive: 'onedrive', s3: 's3' };
const PROVIDER_REMOTE = { dropbox: 'dropbox', gdrive: 'gdrive', onedrive: 'onedrive', s3: 's3' };

// POST /api/v1/wizard/rclone-auth — create rclone remote from pasted token or S3 credentials
router.post('/rclone-auth', (req, res) => {
  const { provider, token, s3Config } = req.body || {};

  if (!provider) return res.status(400).json({ error: 'provider required' });

  const rcloneType = PROVIDER_TYPE[provider];
  const remoteName = PROVIDER_REMOTE[provider];
  if (!rcloneType) return res.status(400).json({ error: `Unknown provider: ${provider}` });

  let args;
  if (provider === 's3') {
    const { accessKeyId = '', secretAccessKey = '', region = 'us-east-1' } = s3Config || {};
    if (!accessKeyId || !secretAccessKey) {
      return res.status(400).json({ error: 'accessKeyId and secretAccessKey required for S3' });
    }
    args = [
      'config', 'create', remoteName, 's3',
      'provider=AWS',
      `access_key_id=${accessKeyId}`,
      `secret_access_key=${secretAccessKey}`,
      `region=${region}`,
    ];
  } else {
    if (!token) return res.status(400).json({ error: 'token required for OAuth providers' });
    args = ['config', 'create', remoteName, rcloneType, `token=${token}`];
  }

  const child = spawn('rclone', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });
  child.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: `Spawn error: ${err.message}` });
  });
  child.on('close', code => {
    if (code !== 0) {
      return res.status(500).json({ error: `rclone config create exited ${code}`, detail: out.trim() });
    }
    // Verify the remote was registered
    try {
      const remotes = execSync('rclone listremotes 2>&1', { timeout: 5000, encoding: 'utf8' });
      if (!remotes.includes(`${remoteName}:`)) {
        return res.status(500).json({ error: 'Remote was not saved to config', detail: out.trim() });
      }
    } catch { /* listremotes failure is non-fatal */ }
    res.json({ ok: true, remote: remoteName });
  });
});


router.post('/build', (req, res) => {
  const { config } = req.body || {};
  const dotenvPath  = process.env.DOTENV_PATH  || (isNative() ? '/etc/printershare/portal.env' : '/config/.env');
  const composeFile = process.env.COMPOSE_FILE || '/config/docker-compose.yml';

  if (config) {
    try {
      mergeEnv(dotenvPath, config);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to write .env', detail: String(err.message) });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sendSse(res, 'log', '==> Writing configuration...');

  // Native LXC: services are installed and managed by scripts/proxmox/install.sh.
  // The wizard's job at this point is just to persist the .env — no rebuild step.
  if (isNative()) {
    sendSse(res, 'log', '==> Native deployment — settings will take effect on next service restart.');
    sendSse(res, 'log', `    Config written to ${dotenvPath}`);
    sendSse(res, 'log', '    Run `systemctl restart printershare-portal` (or use Settings → Services) to apply.');
    const state = loadState();
    state.completed = true;
    saveState(state);
    sendSse(res, 'complete', 'Setup complete! Restart services from the Services page to apply all settings.');
    res.end();
    return;
  }

  sendSse(res, 'log', '==> Applying settings (ensuring all services are up)...');

  // Use --no-recreate so running containers (including nginx which proxies
  // this SSE connection) are never stopped during the wizard run.
  // Settings written to .env will take effect on next manual restart.
  const child = spawn('docker', [
    'compose', '-f', composeFile, '--env-file', dotenvPath,
    '-p', 'printershare', 'up', '-d', '--no-recreate',
  ], { env: { ...process.env, DOCKER_PROGRESS: 'plain' } });

  child.stdout.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));
  child.stderr.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));

  child.on('error', err => {
    sendSse(res, 'error', `Spawn error: ${err.message}`);
    res.end();
  });

  child.on('close', (code, signal) => {
    if (code === 0) {
      const state = loadState();
      state.completed = true;
      saveState(state);
      sendSse(res, 'complete', 'Setup complete! Restart services from the Services page to apply all settings.');
    } else {
      sendSse(res, 'error', `Build failed (exit ${code ?? signal})`);
    }
    res.end();
  });

  // Do NOT kill child when client disconnects — docker compose must finish
  // writing .env changes even if the browser tab is closed mid-flight.
});

// POST /api/v1/wizard/reset
router.post('/reset', (_req, res) => {
  saveState({ step: 0, completed: false, config: {} });
  res.json({ ok: true });
});

module.exports = router;
