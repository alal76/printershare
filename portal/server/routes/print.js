'use strict';

const router = require('express').Router();
const multer = require('multer');
const path   = require('node:path');
const fs     = require('node:fs');
const os     = require('node:os');

const CUPS_HOST = process.env.CUPS_HOST || 'host.docker.internal';
const CUPS_PORT = Number.parseInt(process.env.CUPS_PORT || '631', 10);

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

// GET /api/v1/printer/queue — proxy CUPS job list via IPP (simplified HTTP check)
router.get('/queue', async (_req, res) => {
  try {
    const cupsUrl = `http://${CUPS_HOST}:${CUPS_PORT}/jobs`;
    const r = await fetch(cupsUrl, { signal: AbortSignal.timeout(5000) });
    // CUPS returns HTML — return minimal status
    res.json({ status: r.ok ? 'ok' : 'error', jobs: [] });
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
