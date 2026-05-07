'use strict';

const router = require('express').Router();
const { spawn } = require('node:child_process');

const ALLOWED_SERVICES = new Set([
  'ps-cups', 'ps-ipp-usb', 'ps-scanservjs', 'ps-samba',
  'ps-nfs', 'ps-nginx', 'ps-portal', 'ps-paperless',
  'ps-paperless-db', 'ps-paperless-redis', 'ps-tailscale', 'ps-cloudflared',
]);

// GET /api/v1/logs/:service — SSE stream of docker logs --follow
router.get('/:service', (req, res) => {
  const { service } = req.params;
  if (!ALLOWED_SERVICES.has(service)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  const lines = Number.parseInt(req.query.lines || '200', 10);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const child = spawn('docker', ['logs', '--follow', `--tail=${lines}`, service]);

  const send = data => res.write(`data: ${JSON.stringify({ line: data })}\n\n`);

  child.stdout.on('data', d => send(d.toString()));
  child.stderr.on('data', d => send(d.toString()));
  child.on('close', ()  => res.end());

  req.on('close', () => child.kill());
});

module.exports = router;
