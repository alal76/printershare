'use strict';

const router = require('express').Router();
const multer = require('multer');
const path   = require('node:path');
const fs     = require('node:fs');
const os     = require('node:os');
const { spawnSync } = require('node:child_process');

const CUPS_HOST = process.env.CUPS_HOST || 'host.docker.internal';
const CUPS_PORT = Number.parseInt(process.env.CUPS_PORT || '631', 10);

function run(command, args, timeout = 5000) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited with ${result.status}`);
  }
  return result.stdout.trim();
}

function parseQueue() {
  const out = run('lpstat', ['-W', 'not-completed'], 5000);
  const lines = out ? out.split('\n') : [];
  const jobs = [];

  for (const line of lines) {
    const m = /^(\S+)-(\d+)\s+\S+\s+(\d+)\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    jobs.push({
      id: `${m[1]}-${m[2]}`,
      name: `${m[1]} #${m[2]}`,
      state: 'processing',
      size: Number.parseInt(m[3], 10) || 0,
      created: m[4],
    });
  }

  return jobs;
}

function parsePrinterState() {
  const out = run('lpstat', ['-r'], 3000);
  return out.toLowerCase().includes('is running') ? 'ok' : 'error';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => cb(null, `print_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// GET /api/v1/printer/queue — CUPS queue and scheduler state
router.get('/queue', async (_req, res) => {
  try {
    const status = parsePrinterState();
    const jobs = parseQueue();
    res.json({ status, jobs, host: CUPS_HOST, port: CUPS_PORT });
  } catch (err) {
    res.json({ status: 'error', message: String(err.message), jobs: [] });
  }
});

// GET /api/v1/printer/printers — list CUPS printers
router.get('/printers', async (_req, res) => {
  try {
    const { listPrinters } = require('../services/cups-client');
    const printers = await listPrinters();
    res.json({ printers });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// POST /api/v1/printer/print — upload + print
router.post('/print', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or unsupported type (PDF/JPEG/PNG only)' });
  }

  const printer = req.body.printer || 'default';

  try {
    const { printFile } = require('../services/cups-client');
    const jobId = await printFile(req.file.path, printer, {
      copies: req.body.copies || '1',
      color:  req.body.color  || 'auto',
    });
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
  }
});

module.exports = router;
