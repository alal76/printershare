'use strict';

/**
 * @module routes/wizard
 * @description Setup-wizard REST endpoints.
 *
 * GET  /api/v1/wizard/state       – Returns the persisted wizard state
 * POST /api/v1/wizard/state       – Advances the wizard step and merges config
 * GET  /api/v1/wizard/prereqs     – Checks docker compose + rclone availability
 * POST /api/v1/wizard/rclone-auth – Creates an rclone remote from a pasted token or S3 keys
 * POST /api/v1/wizard/build       – Writes .env and streams docker compose up via SSE
 * POST /api/v1/wizard/reset       – Clears persisted state
 */

const router = require('express').Router();
const fs     = require('node:fs');
const path   = require('node:path');
const { spawn, execSync, spawnSync } = require('node:child_process');
const { sanitizePatch } = require('./settings');

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

// GET /api/v1/wizard/prereqs — check required tools are available in the container
router.get('/prereqs', (_req, res) => {
  const result = {};

  try {
    const ver = execSync('docker compose version 2>&1', { timeout: 5000, encoding: 'utf8' }).trim();
    result.dockerCompose = { ok: true, detail: ver.split('\n')[0] };
  } catch {
    result.dockerCompose = { ok: false, detail: 'docker compose plugin not found' };
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

function printPackages(make) {
  return PRINT_PKG_MAP[(make || '').toLowerCase()] || [];
}
function scanPackages(make) {
  return SCAN_PKG_MAP[(make || '').toLowerCase()] || [];
}

// GET /api/v1/wizard/scan-devices — list SANE-visible scanners via scanimage -L
router.get('/scan-devices', (_req, res) => {
  try {
    const raw = execSync('docker exec ps-scanservjs scanimage -L 2>&1', {
      timeout: 20000, encoding: 'utf8',
    });
    // Each line: device `backend:path' is a <description>
    const scanners = [];
    for (const line of raw.split('\n')) {
      const m = line.match(/^device [`']([^`']+)[`'] is a (.+)$/);
      if (m) scanners.push({ device: m[1], description: m[2].trim() });
    }
    res.json({ scanners, raw: raw.trim() });
  } catch (err) {
    res.json({ scanners: [], raw: String(err.message) });
  }
});

// GET /api/v1/wizard/driver-check — check printer + scanner driver availability
// Query params: vidpid, make, print=1, scan=1
router.get('/driver-check', (req, res) => {
  const { vidpid = '', make = '', print: wantPrint = '0', scan: wantScan = '0' } = req.query;
  const result = { vidpid, make, print: null, scan: null };

  if (wantPrint === '1') {
    result.print = checkPrintDriver(make);
  }

  if (wantScan === '1') {
    result.scan = checkScanDriver(make, vidpid);
  }

  res.json(result);
});

function checkPrintDriver(make) {
  if (make && !SAFE_MAKE.test(make)) {
    return { ok: false, packages: [], detail: 'Invalid make value' };
  }
  try {
    const result  = spawnSync('docker', ['exec', 'ps-cups', 'lpinfo', '-m'], { timeout: 20000, encoding: 'utf8' });
    const output  = ((result.stdout || '') + (result.stderr || '')).split('\n');
    const lines   = make
      ? output.filter(l => l.toLowerCase().includes(make.toLowerCase())).slice(0, 5)
      : output.slice(0, 5);
    const hasPpd  = lines.some(l => l.trim().length > 0);
    const missing = printPackages(make);
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
    const saneList = execSync('docker exec ps-scanservjs scanimage -L 2>&1', { timeout: 15000, encoding: 'utf8' });
    const found    = saneList.toLowerCase().includes(make.toLowerCase()) ||
                     (vidpid && saneList.includes(vidpid.split(':')[0]));
    const missing  = scanPackages(make);
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
  const printPkgs = caps.includes('print') ? printPackages(make) : [];
  const scanPkgs  = caps.includes('scan')  ? scanPackages(make)  : [];

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
  sendSse(res, 'log', '==> Updating package lists in ps-cups...');
  const update = spawn('docker', ['exec', 'ps-cups', 'apt-get', 'update', '-qq'], {
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

  sendSse(res, 'log', `==> Installing ${label} virtual printer packages (${packages.join(', ')}) in ps-cups...`);

  const update = spawn('docker', ['exec', 'ps-cups', 'apt-get', 'update', '-qq'], {
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });
  update.on('error', () => doInstallVirtual(packages, queueName, isPdf, res));
  update.on('close', () => doInstallVirtual(packages, queueName, isPdf, res));
}

function doInstallVirtual(packages, queueName, isPdf, res) {
  const install = spawn('docker', [
    'exec', 'ps-cups', 'apt-get', 'install', '-y', '--no-install-recommends', ...packages,
  ], { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });

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
  const lpadmin = spawn('docker', [
    'exec', 'ps-cups',
    'lpadmin', '-p', queueName, '-E', '-v', 'cups-pdf:/', '-P', '/usr/share/ppd/cups-pdf/CUPS-PDF_opt.ppd',
    '-o', 'printer-is-shared=true',
  ]);
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

  const writeScript = spawn('docker', [
    'exec', 'ps-cups', 'sh', '-c',
    `printf '%s\n' ${JSON.stringify(postScript)} > /usr/local/bin/cups-pdf-xps.sh && chmod +x /usr/local/bin/cups-pdf-xps.sh`,
  ]);

  writeScript.on('close', () => {
    // Add PostProcessing line to cups-pdf.conf (idempotent grep+append)
    const patchConf = spawn('docker', [
      'exec', 'ps-cups', 'sh', '-c',
      'grep -q "^PostProcessing" /etc/cups/cups-pdf.conf 2>/dev/null' +
      ' || echo "PostProcessing /usr/local/bin/cups-pdf-xps.sh" >> /etc/cups/cups-pdf.conf',
    ]);
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
    sendSse(res, 'log', `==> Installing ${label} (${packages.join(' ')}) in ${container}...`);
    const child = spawn('docker', [
      'exec', container, 'apt-get', 'install', '-y', '--no-install-recommends', ...packages,
    ], { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });
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
  const dotenvPath  = process.env.DOTENV_PATH  || '/config/.env';
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
