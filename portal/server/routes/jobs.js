'use strict';

/**
 * @module server/routes/jobs
 * @description Unified job-status endpoint for the dashboard.
 *
 *   GET /api/v1/jobs
 *     → { print: { jobs: [...] }, scan: { active, queued, ... } }
 *
 * Print jobs come from `lpstat -W not-completed` (active + held).
 * Scan jobs come from the in-process DeviceLock telemetry — there is no
 * persistent queue for scans because scanservjs/airsane scan synchronously.
 */

const router = require('express').Router();
const { spawnSync } = require('node:child_process');
const { getJobStatus } = require('../lib/device-lock');

const CUPS_LOCAL = process.env.CUPS_LOCAL === '1';
const CUPS_CONTAINER = process.env.CUPS_CONTAINER || 'ps-cups';

function runLpstat(args, timeout = 5_000) {
  const [cmd, cmdArgs] = CUPS_LOCAL
    ? ['lpstat', args]
    : ['docker', ['exec', CUPS_CONTAINER, 'lpstat', ...args]];
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout });
  if (r.status !== 0) return '';
  return (r.stdout || '').trim();
}

function parsePrintLine(line, defaultState) {
  const m = /^(\S+)-(\d+)\s+\S+\s+(\d+)\s+(.+?)(?:\s+(completed|aborted|canceled))?$/.exec(line.trim());
  if (!m) return null;
  let state = defaultState;
  const word = (m[5] || '').toLowerCase();
  if (word === 'aborted')   state = 'failed';
  if (word === 'canceled')  state = 'canceled';
  if (word === 'completed') state = 'completed';
  return {
    id:      `${m[1]}-${m[2]}`,
    name:    `${m[1]} #${m[2]}`,
    state,
    size:    Number.parseInt(m[3], 10) || 0,
    created: m[4].trim(),
  };
}

function listPrintJobs() {
  const out = runLpstat(['-W', 'not-completed']);
  if (!out) return [];
  return out
    .split('\n')
    .map(l => parsePrintLine(l, 'processing'))
    .filter(Boolean);
}

router.get('/', (_req, res) => {
  try {
    const print = listPrintJobs();
    const scan = getJobStatus();
    res.json({
      print: { jobs: print, count: print.length },
      scan,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

module.exports = router;
