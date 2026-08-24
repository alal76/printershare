// Beta test version v1.2.0
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
const { MODE } = require('./lib/deployment');
const { makeLogger } = require('./lib/logger');
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const log = makeLogger('startup');

app.listen(PORT, '0.0.0.0', () => {
  const cupsDefault = MODE === 'native' ? '127.0.0.1' : 'host.docker.internal';
  log.info('Listening', {
    url:    `http://0.0.0.0:${PORT}`,
    mode:   MODE,
    cups:   `${process.env.CUPS_HOST || cupsDefault}:${process.env.CUPS_PORT || 631}`,
    scans:  process.env.SCANS_PATH || '/scans',
  });
});
