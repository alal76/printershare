// Beta test version v1.2.0
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
const { AUTH_ENABLED, readSessionToken, verifySessionToken } = require('./lib/auth');
const { makeLogger } = require('./lib/logger');

const app = express();

// nginx is the only thing that can reach the portal's port; trust its
// X-Forwarded-For so audit log entries record the real client IP instead
// of nginx's own loopback address.
app.set('trust proxy', true);

// ── Security / body-parsing middleware ────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// Remove the X-Powered-By header to reduce information disclosure.
app.disable('x-powered-by');

function requireApiAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();

  if (!req.path.startsWith('/api/')) return next();

  // Keep health and auth endpoints unauthenticated.
  if (
    req.path === '/api/v1/health' ||
    req.path.startsWith('/api/v1/health/') ||
    req.path === '/api/v1/auth/login' ||
    req.path === '/api/v1/auth/me' ||
    req.path === '/api/v1/auth/config'
  ) {
    return next();
  }

  const payload = verifySessionToken(readSessionToken(req));
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  req.user = payload.sub;
  return next();
}

app.use(requireApiAuth);

// ── Request logging ─────────────────────────────────────────────────────────
// Mutating API calls (anything that isn't a GET) are logged at "info" under
// the "audit" category regardless of LOG_LEVEL — who changed what matters
// for accountability once more than one admin has access. Routine GETs
// (dashboard polling, device refreshes, health checks) are logged at
// "debug" so they're silent unless someone explicitly wants that detail.
const httpLog  = makeLogger('http');
const auditLog = makeLogger('audit');

app.use((req, res, next) => {
  const start = Date.now();
  // Capture method/path now, before any mounted sub-router runs — Express
  // rewrites req.url (and therefore req.path) to be relative to the mount
  // point while a sub-router handles the request, and by the time the
  // async 'finish' event fires that rewrite is still in effect, so reading
  // req.path live inside the callback silently logs the wrong (and
  // wrongly-classified) path.
  const { method, path } = req;
  res.on('finish', () => {
    const meta = {
      status: res.statusCode,
      ms:     Date.now() - start,
      user:   req.user || 'anonymous',
      ip:     req.ip,
    };
    const isMutation = method !== 'GET' && path.startsWith('/api/');
    if (isMutation) {
      auditLog.info(`${method} ${path}`, meta);
    } else if (path !== '/api/v1/health') {
      httpLog.debug(`${method} ${path}`, meta);
    }
  });
  next();
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/health',   require('./routes/health'));
app.use('/api/v1/auth',     require('./routes/auth'));
app.use('/api/v1/system',   require('./routes/system'));
app.use('/api/v1/wizard',   require('./routes/wizard'));
app.use('/api/v1/scans',    require('./routes/scans'));
app.use('/api/v1/printer',  require('./routes/print'));
app.use('/api/v1/settings', require('./routes/settings'));
app.use('/api/v1/logs',     require('./routes/logs'));
app.use('/api/v1/services', require('./routes/services'));
app.use('/api/v1/devices',  require('./routes/devices'));
app.use('/api/v1/jobs',     require('./routes/jobs'));

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
