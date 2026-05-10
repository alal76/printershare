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

// ── Background device-recovery watcher ────────────────────────────────────────
// CUPS can hold the USB interface open in a way that blocks the SANE backend,
// and queues sometimes flip to "disabled" after USB transients.  Run a light
// recovery sweep every few minutes so things heal without operator action.
const RECOVERY_INTERVAL_MS = Number.parseInt(
  process.env.DEVICE_RECOVERY_INTERVAL_MS || '300000', 10,
);
if (RECOVERY_INTERVAL_MS > 0 && process.env.NODE_ENV !== 'test') {
  const { runRecovery } = require('./routes/devices');
  const tick = () => {
    try {
      const r = runRecovery();
      if (r.enabled.length || r.cycled.length || r.errors.length) {
        console.log('[recovery]', JSON.stringify(r));
      }
    } catch (e) {
      console.warn('[recovery] failed:', e.message);
    }
  };
  // First run after a short startup delay so dependent services come up first.
  setTimeout(tick, 30_000);
  setInterval(tick, RECOVERY_INTERVAL_MS).unref();
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[portal] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[portal] CUPS  → ${process.env.CUPS_HOST || 'host.docker.internal'}:${process.env.CUPS_PORT || 631}`);
  console.log(`[portal] Scans → ${process.env.SCANS_PATH || '/scans'}`);
});
