// Beta test version v1.2.0
'use strict';

/**
 * @module lib/logger
 * @description Minimal structured logger. Writes to stdout/stderr, which
 * systemd captures into the journal (`journalctl -u printershare-portal`) —
 * no file handling or rotation needed on the portal's side; that's handled
 * by journald's own retention (see printershare's journald.conf.d drop-in)
 * for the process's own logs, and logrotate for the handful of plain files
 * the shell-script side of this project writes (hotplug, scan-purge,
 * backup).
 *
 * Two output formats:
 *  - default: human-readable line, easy to `journalctl -f` and grep
 *  - LOG_FORMAT=json: one JSON object per line, for log shipping/aggregation
 *
 * LOG_LEVEL (default "info") filters by minimum level: debug < info < warn < error.
 * Routine per-request GET logging is emitted at "debug" so it's silent by
 * default; mutating API calls are logged at "info" under the "audit"
 * category regardless of level, since those matter for accountability in a
 * shared/organizational deployment.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
const JSON_FORMAT = (process.env.LOG_FORMAT || '').toLowerCase() === 'json';

function emit(level, category, message, meta) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const stream = (level === 'error' || level === 'warn') ? process.stderr : process.stdout;
  const ts = new Date().toISOString();

  if (JSON_FORMAT) {
    stream.write(`${JSON.stringify({ ts, level, category, message, ...meta })}\n`);
    return;
  }

  const metaStr = meta && Object.keys(meta).length
    ? ` ${Object.entries(meta).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`
    : '';
  stream.write(`${ts} ${level.toUpperCase().padEnd(5)} [${category}] ${message}${metaStr}\n`);
}

/**
 * @param {string} category short subsystem tag, e.g. 'http', 'audit', 'startup'
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
function makeLogger(category) {
  return {
    debug: (message, meta) => emit('debug', category, message, meta),
    info:  (message, meta) => emit('info',  category, message, meta),
    warn:  (message, meta) => emit('warn',  category, message, meta),
    error: (message, meta) => emit('error', category, message, meta),
  };
}

module.exports = { makeLogger };
