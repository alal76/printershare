'use strict';

const router = require('express').Router();
const fs     = require('node:fs');
const path   = require('node:path');
const { spawn } = require('node:child_process');

const DATA_DIR   = process.env.PORTAL_DATA_DIR || '/app/data';
const STATE_FILE = path.join(DATA_DIR, 'wizard-state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return { step: 0, completed: false, config: {} };
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// GET /api/v1/wizard/state
router.get('/state', (_req, res) => {
  res.json(loadState());
});

// POST /api/v1/wizard/state — advance wizard step
router.post('/state', (req, res) => {
  const { step, data } = req.body;
  if (typeof step !== 'number') {
    return res.status(400).json({ error: 'step must be a number' });
  }
  const state = loadState();
  state.step   = step;
  state.config = { ...state.config, ...data };
  saveState(state);
  res.json({ ok: true, state });
});

/**
 * Merge key=value pairs from config object into the .env file.
 */
function mergeEnv(dotenvPath, config) {
  let existing = '';
  try { existing = fs.readFileSync(dotenvPath, 'utf8'); } catch { /* new file */ }
  const lines = existing.split('\n');
  for (const [k, v] of Object.entries(config)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const idx = lines.findIndex(l => l.startsWith(`${k}=`));
    const line = `${k}=${String(v)}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  fs.writeFileSync(dotenvPath, lines.filter(Boolean).join('\n') + '\n');
}

function sendSse(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
}

// POST /api/v1/wizard/build — stream docker compose up output via SSE
router.post('/build', (req, res) => {
  const { config } = req.body || {};
  const dotenvPath  = process.env.DOTENV_PATH  || '/config/.env';
  const composeFile = process.env.COMPOSE_FILE || '/config/docker-compose.yml';

  if (config) {
    try {
      mergeEnv(dotenvPath, config);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to write .env', detail: String(err.message) });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sendSse(res, 'log', '==> Writing configuration...');

  const state = loadState();
  state.completed = true;
  saveState(state);

  sendSse(res, 'log', '==> Starting docker compose build...');

  const child = spawn('docker', [
    'compose', '-f', composeFile, 'up', '--build', '-d',
  ], { env: { ...process.env, DOCKER_BUILDKIT: '1' } });

  child.stdout.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));
  child.stderr.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));

  child.on('close', code => {
    sendSse(res, code === 0 ? 'complete' : 'error',
      code === 0 ? 'Build successful' : `Build failed (exit ${code})`);
    res.end();
  });

  req.on('close', () => child.kill());
});

// POST /api/v1/wizard/reset
router.post('/reset', (_req, res) => {
  saveState({ step: 0, completed: false, config: {} });
  res.json({ ok: true });
});

module.exports = router;
