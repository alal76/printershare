'use strict';

/**
 * @module server/app
 * @description Builds and exports the Express application without calling
 * `app.listen()`.  Keeping the listen call in {@link module:server/index}
 * allows this module to be `require()`'d by unit-test suites (e.g. supertest)
 * without binding to a real TCP port.
 *
 * Route layout
 * ────────────
 *  GET  /health                → quick Docker HEALTHCHECK stub
 *  *    /api/v1/health         → full service-health probe
 *  *    /api/v1/system         → system info + USB device list
 *  *    /api/v1/wizard         → setup wizard state & build SSE
 *  *    /api/v1/scans          → scan file listing / download / delete
 *  *    /api/v1/printer        → CUPS print queue & print-job submission
 *  *    /api/v1/settings       → .env read / patch
 *  *    /api/v1/logs/:service  → docker log SSE stream
 *  *    /api/v1/services/:name → service restart
 *  GET  /*                     → Vue SPA fallback (index.html)
 */

const express = require('express');
const path    = require('node:path');

const app = express();

// ── Security / body-parsing middleware ────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// Remove the X-Powered-By header to reduce information disclosure.
app.disable('x-powered-by');

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/health',   require('./routes/health'));
app.use('/api/v1/system',   require('./routes/system'));
app.use('/api/v1/wizard',   require('./routes/wizard'));
app.use('/api/v1/scans',    require('./routes/scans'));
app.use('/api/v1/printer',  require('./routes/print'));
app.use('/api/v1/settings', require('./routes/settings'));
app.use('/api/v1/logs',     require('./routes/logs'));
app.use('/api/v1/services', require('./routes/services'));
app.use('/api/v1/devices',  require('./routes/devices'));

// ── Quick healthcheck endpoint (used by Docker HEALTHCHECK instruction) ───────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Serve built Vue SPA (Vite output → portal/public/) ────────────────────────
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir, { maxAge: '1d', etag: true }));

// ── SPA catch-all fallback ────────────────────────────────────────────────────
// Any request that does not match a static asset or an /api/ prefix is
// forwarded to index.html so that Vue Router handles client-side navigation.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

module.exports = app;
