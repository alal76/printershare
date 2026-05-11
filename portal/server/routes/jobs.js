// Beta test version v1.2.0
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
const { cupsCmd } = require('../lib/deployment');

function runLpstat(args, timeout = 5_000) {
  const { cmd, args: cmdArgs } = cupsCmd(['lpstat', ...args]);
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
