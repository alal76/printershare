'use strict';

const router = require('express').Router();
const { restartService, SERVICE_MAP } = require('../lib/deployment');

const ALLOWED_SERVICES = new Set(Object.keys(SERVICE_MAP));

// POST /api/v1/services/:name/restart
router.post('/:name/restart', (req, res) => {
  const { name } = req.params;
  if (!ALLOWED_SERVICES.has(name)) {
    return res.status(400).json({ error: 'Unknown service' });
  }
  const result = restartService(name);
  if (!result.ok) {
    return res.status(500).json({ error: result.message || 'Restart failed' });
  }
  res.json({ ok: true });
});

module.exports = router;
