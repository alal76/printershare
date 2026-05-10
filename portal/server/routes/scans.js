'use strict';

const router = require('express').Router();
const fs     = require('node:fs');
const path   = require('node:path');
const mime   = require('mime-types');
const { withScanLock } = require('../lib/device-lock');

const SCANS_PATH  = process.env.SCANS_PATH || '/scans';
const SCANSERVJS_URL = process.env.SCANSERVJS_URL || 'http://ps-scanservjs:8080';

const MAX_PREVIEW = 100; // max files to list

/** Safe basename — strip any path traversal */
function safeName(name) {
  return path.basename(name).replaceAll(/[^a-zA-Z0-9._-]/g, '_');
}

// GET /api/v1/scans — list files
router.get('/', (_req, res) => {
  try {
    if (!fs.existsSync(SCANS_PATH)) return res.json({ files: [] });
    const entries = fs.readdirSync(SCANS_PATH, { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => {
        const full = path.join(SCANS_PATH, e.name);
        const stat = fs.statSync(full);
        return {
          name:      e.name,
          size:      stat.size,
          date:      stat.mtime.toISOString(),
          mimeType:  mime.lookup(e.name) || 'application/octet-stream',
          url:       `/api/v1/scans/${encodeURIComponent(e.name)}`,
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, MAX_PREVIEW);
    res.json({ files: entries });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// GET /api/v1/scans/:filename — download a file
router.get('/:filename', (req, res) => {
  const name = safeName(req.params.filename);
  const full = path.join(SCANS_PATH, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  const mimeType = mime.lookup(name) || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  res.sendFile(full);
});

// DELETE /api/v1/scans/:filename
router.delete('/:filename', (req, res) => {
  const name = safeName(req.params.filename);
  const full = path.join(SCANS_PATH, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(full);
  res.status(204).end();
});

/**
 * POST /api/v1/scans/run
 * Body: scanservjs scan request payload
 *   { params: { deviceId, mode, source, resolution, ... },
 *     pipeline, filters, batch, index }
 *
 * Acquires the device lock so CUPS releases the USB interface, forwards the
 * request to scanservjs, then returns the device to CUPS.  Concurrent scan
 * requests serialize behind the same lock; a print job in flight blocks the
 * scan until the print finishes (cupsdisable -h waits for active jobs).
 */
router.post('/run', async (req, res) => {
  try {
    const result = await withScanLock(async () => {
      const upstream = await fetch(`${SCANSERVJS_URL}/api/v1/scan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(req.body ?? {}),
      });
      const text = await upstream.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      return { status: upstream.status, body };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 300) });
  }
});

module.exports = router;
