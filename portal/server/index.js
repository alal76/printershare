// Beta test version v1.2.0
'use strict';

/**
 * @module server/index
 * @description Entry point — loads environment configuration, then starts the
 * HTTP server.  The Express app is defined in {@link module:server/app} to
 * keep it importable by test suites without binding a port.
 */

// isNative() only reads process.env (CUPS_LOCAL / DEPLOYMENT_MODE, both set
// by systemd's Environment= before node starts), so it's safe to check
// before dotenv has run — needed here because the default env-file path
// differs between native/LXC and Docker (see lib/env.js's DOTENV_PATH).
const { MODE, isNative } = require('./lib/deployment');

// Load .env FIRST so that all route modules read the correct env vars.
const dotenvDefault = isNative() ? '/etc/printershare/portal.env' : '/config/.env';
require('dotenv').config({ path: process.env.DOTENV_PATH || dotenvDefault });

const app  = require('./app');
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
