'use strict';

/**
 * @module routes/wizard
 * @description Setup-wizard REST endpoints.
 *
 * GET  /api/v1/wizard/state       – Returns the persisted wizard state
 * POST /api/v1/wizard/state       – Advances the wizard step and merges config
 * GET  /api/v1/wizard/prereqs     – Checks docker compose + rclone availability
 * POST /api/v1/wizard/rclone-auth – Creates an rclone remote from a pasted token or S3 keys
 * POST /api/v1/wizard/build       – Writes .env and streams docker compose up via SSE
 * POST /api/v1/wizard/reset       – Clears persisted state
 */

const router = require('express').Router();
const fs     = require('node:fs');
const path   = require('node:path');
const os     = require('node:os');
const { spawn, execSync } = require('node:child_process');
const { sanitizePatch } = require('./settings');

const DATA_DIR   = process.env.PORTAL_DATA_DIR || '/app/data';
const STATE_FILE = path.join(DATA_DIR, 'wizard-state.json');

/**
 * Load the wizard state from disk.
 * @returns {{ step: number, completed: boolean, config: Record<string,string> }}
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch { /* ignore corrupt state */ }
  return { step: 0, completed: false, config: {} };
}

/**
 * Persist the wizard state to disk.
 * @param {{ step: number, completed: boolean, config: Record<string,string> }} state
 */
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
 * Only keys that pass sanitizePatch validation are written.
 */
function mergeEnv(dotenvPath, config) {
  const clean = sanitizePatch(config);
  let existing = '';
  try { existing = fs.readFileSync(dotenvPath, 'utf8'); } catch { /* new file */ }
  const lines = existing.split('\n');
  for (const [k, v] of Object.entries(clean)) {
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

// GET /api/v1/wizard/prereqs — check required tools are available in the container
router.get('/prereqs', (_req, res) => {
  const result = {};

  try {
    const ver = execSync('docker compose version 2>&1', { timeout: 5000, encoding: 'utf8' }).trim();
    result.dockerCompose = { ok: true, detail: ver.split('\n')[0] };
  } catch {
    result.dockerCompose = { ok: false, detail: 'docker compose plugin not found' };
  }

  try {
    const ver = execSync('rclone version 2>&1', { timeout: 5000, encoding: 'utf8' })
      .trim().split('\n')[0];
    result.rclone = { ok: true, detail: ver };
  } catch {
    result.rclone = { ok: false, detail: 'rclone not installed' };
  }

  res.json(result);
});

/**
 * Map wizard provider names to rclone backend types and remote names.
 */
const PROVIDER_TYPE = { dropbox: 'dropbox', gdrive: 'drive', onedrive: 'onedrive', s3: 's3' };
const PROVIDER_REMOTE = { dropbox: 'dropbox', gdrive: 'gdrive', onedrive: 'onedrive', s3: 's3' };

// POST /api/v1/wizard/rclone-auth — create rclone remote from pasted token or S3 credentials
router.post('/rclone-auth', (req, res) => {
  const { provider, token, s3Config } = req.body || {};

  if (!provider) return res.status(400).json({ error: 'provider required' });

  const rcloneType = PROVIDER_TYPE[provider];
  const remoteName = PROVIDER_REMOTE[provider];
  if (!rcloneType) return res.status(400).json({ error: `Unknown provider: ${provider}` });

  let args;
  if (provider === 's3') {
    const { accessKeyId = '', secretAccessKey = '', region = 'us-east-1' } = s3Config || {};
    if (!accessKeyId || !secretAccessKey) {
      return res.status(400).json({ error: 'accessKeyId and secretAccessKey required for S3' });
    }
    args = [
      'config', 'create', remoteName, 's3',
      'provider=AWS',
      `access_key_id=${accessKeyId}`,
      `secret_access_key=${secretAccessKey}`,
      `region=${region}`,
    ];
  } else {
    if (!token) return res.status(400).json({ error: 'token required for OAuth providers' });
    args = ['config', 'create', remoteName, rcloneType, `token=${token}`];
  }

  const child = spawn('rclone', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });
  child.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: `Spawn error: ${err.message}` });
  });
  child.on('close', code => {
    if (code !== 0) {
      return res.status(500).json({ error: `rclone config create exited ${code}`, detail: out.trim() });
    }
    // Verify the remote was registered
    try {
      const remotes = execSync('rclone listremotes 2>&1', { timeout: 5000, encoding: 'utf8' });
      if (!remotes.includes(`${remoteName}:`)) {
        return res.status(500).json({ error: 'Remote was not saved to config', detail: out.trim() });
      }
    } catch { /* listremotes failure is non-fatal */ }
    res.json({ ok: true, remote: remoteName });
  });
});


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

  sendSse(res, 'log', '==> Starting docker compose build...');

  const child = spawn('docker', [
    'compose', '-f', composeFile, 'up', '--build', '-d',
  ], { env: { ...process.env, DOCKER_BUILDKIT: '1' } });

  child.stdout.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));
  child.stderr.on('data', d => sendSse(res, 'log', d.toString().trimEnd()));

  child.on('error', err => {
    sendSse(res, 'error', `Spawn error: ${err.message}`);
    res.end();
  });

  child.on('close', code => {
    if (code === 0) {
      const state = loadState();
      state.completed = true;
      saveState(state);
      sendSse(res, 'complete', 'Build successful');
    } else {
      sendSse(res, 'error', `Build failed (exit ${code})`);
    }
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
