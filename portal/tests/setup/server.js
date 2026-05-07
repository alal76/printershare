'use strict';

/**
 * Server-side test setup.
 * Sets mandatory environment variables before any route module is required.
 */

process.env.PORTAL_DATA_DIR = '/tmp/ps-test-data';
process.env.SCANS_PATH      = '/tmp/ps-test-scans';
process.env.DOTENV_PATH     = '/tmp/ps-test.env';
process.env.CUPS_HOST       = '127.0.0.1';
process.env.CUPS_PORT       = '16310';
