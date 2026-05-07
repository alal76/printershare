'use strict';

const router = require('express').Router();
const fs     = require('node:fs');
const path   = require('node:path');
const multer = require('multer');
const mime   = require('mime-types');

const SCANS_PATH  = process.env.SCANS_PATH || '/scans';
const MAX_PREVIEW = 100; // max files to list

// Multer: memory storage (files are read-only from container)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

module.exports = router;
