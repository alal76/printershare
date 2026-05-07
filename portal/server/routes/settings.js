'use strict';

const router = require('express').Router();
const fs     = require('node:fs');
const path   = require('node:path');

const DOTENV_PATH = process.env.DOTENV_PATH || '/config/.env';

/** Parse .env file into a key-value map (redacts passwords). */
function readEnv(redact = true) {
  const result = {};
  try {
    const lines = fs.readFileSync(DOTENV_PATH, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      const isPassword = /pass|secret|token|key/i.test(key);
      result[key] = (redact && isPassword) ? '••••••••' : val;
    }
  } catch { /* file not found */ }
  return result;
}

/** Write a partial update back to .env */
function writeEnvPatch(patch) {
  let content = '';
  try { content = fs.readFileSync(DOTENV_PATH, 'utf8'); } catch { /* new */ }
  const lines = content.split('\n');
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    // Prevent injection
    const safeKey = k.replaceAll(/[^A-Z0-9_]/gi, '_');
    const safeVal = String(v).replaceAll('\n', '');
    const idx = lines.findIndex(l => l.startsWith(`${safeKey}=`));
    if (idx >= 0) lines[idx] = `${safeKey}=${safeVal}`;
    else lines.push(`${safeKey}=${safeVal}`);
  }
  fs.mkdirSync(path.dirname(DOTENV_PATH), { recursive: true });
  fs.writeFileSync(DOTENV_PATH, lines.filter(l => l !== '').join('\n') + '\n');
}

// GET /api/v1/settings
router.get('/', (_req, res) => {
  res.json(readEnv(true));
});

// PATCH /api/v1/settings
router.patch('/', (req, res) => {
  const patch = req.body;
  if (!patch || typeof patch !== 'object') {
    return res.status(400).json({ error: 'Expected JSON object' });
  }
  try {
    writeEnvPatch(patch);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

module.exports = router;
