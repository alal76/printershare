'use strict';

const express = require('express');
const path    = require('node:path');

require('dotenv').config({ path: process.env.DOTENV_PATH || '/config/.env' });

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── API routes ──────────────────────────────────────────────────────────────
app.use('/api/v1/health',   require('./routes/health'));
app.use('/api/v1/system',   require('./routes/system'));
app.use('/api/v1/wizard',   require('./routes/wizard'));
app.use('/api/v1/scans',    require('./routes/scans'));
app.use('/api/v1/printer',  require('./routes/print'));
app.use('/api/v1/settings', require('./routes/settings'));
app.use('/api/v1/logs',     require('./routes/logs'));
app.use('/api/v1/services', require('./routes/services'));

// ── Health stub (also at root-level for Docker HEALTHCHECK) ─────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Serve built Vue SPA ──────────────────────────────────────────────────────
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir, { maxAge: '1d' }));

// SPA fallback — all non-API routes return index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[portal] Server listening on port ${PORT}`);
  console.log(`[portal] CUPS at ${process.env.CUPS_HOST || 'host.docker.internal'}:${process.env.CUPS_PORT || 631}`);
  console.log(`[portal] Scans path: ${process.env.SCANS_PATH || '/scans'}`);
});
