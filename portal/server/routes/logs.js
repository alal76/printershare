'use strict';

const router = require('express').Router();
const { streamLogs, SERVICE_MAP } = require('../lib/deployment');

// Accept both logical names (`cups`) and legacy container names (`ps-cups`)
// for back-compat with the existing API surface.
const ALIAS = {};
for (const name of Object.keys(SERVICE_MAP)) {
  ALIAS[name] = name;
  if (SERVICE_MAP[name].container) ALIAS[SERVICE_MAP[name].container] = name;
}

// GET /api/v1/logs/:service — SSE stream of follow logs (docker logs or journalctl)
router.get('/:service', (req, res) => {
  const { service } = req.params;
  const logical = ALIAS[service];
  if (!logical) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  const lines = Number.parseInt(req.query.lines || '200', 10);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let child;
  try {
    child = streamLogs(logical, lines);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ line: `ERROR: ${err.message}` })}\n\n`);
    return res.end();
  }

  const send = data => res.write(`data: ${JSON.stringify({ line: data })}\n\n`);

  child.stdout.on('data', d => send(d.toString()));
  child.stderr.on('data', d => send(d.toString()));
  child.on('close', ()  => res.end());

  req.on('close', () => child.kill());
});

module.exports = router;
