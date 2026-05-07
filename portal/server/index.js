'use strict';

/**
 * @module server/index
 * @description Entry point — loads environment configuration, then starts the
 * HTTP server.  The Express app is defined in {@link module:server/app} to
 * keep it importable by test suites without binding a port.
 */

// Load .env FIRST so that all route modules read the correct env vars.
require('dotenv').config({ path: process.env.DOTENV_PATH || '/config/.env' });

const app  = require('./app');
const PORT = Number.parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[portal] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[portal] CUPS  → ${process.env.CUPS_HOST || 'host.docker.internal'}:${process.env.CUPS_PORT || 631}`);
  console.log(`[portal] Scans → ${process.env.SCANS_PATH || '/scans'}`);
});
