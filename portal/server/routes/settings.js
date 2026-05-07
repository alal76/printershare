'use strict';

/**
 * @module routes/settings
 * @description REST endpoints for reading and writing the `.env` runtime
 * configuration file that is bind-mounted into the container.
 *
 * GET  /api/v1/settings       – Returns all keys (sensitive values redacted).
 * PATCH /api/v1/settings      – Merges a partial key-value object into the
 *                               file; unknown keys are appended.
 */

const router = require('express').Router();
const { readEnv, writeEnvPatch } = require('../lib/env');

/**
 * GET /api/v1/settings
 * @returns {Record<string, string>} All .env keys; sensitive values replaced
 *   with {@link REDACT_PLACEHOLDER}.
 */
router.get('/', (_req, res) => {
  res.json(readEnv(undefined, true));
});

/**
 * PATCH /api/v1/settings
 * @param {Record<string, string>} req.body - Key-value pairs to update.
 */
router.patch('/', (req, res) => {
  const patch = req.body;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return res.status(400).json({ error: 'Expected a JSON object' });
  }
  try {
    writeEnvPatch(patch);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

module.exports = router;
