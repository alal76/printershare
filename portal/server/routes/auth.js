// Beta test version v1.2.0
'use strict';

const router = require('express').Router();
const {
  AUTH_ENABLED,
  AUTH_USER,
  isDefaultPassword,
  setRuntimePassword,
  createSessionToken,
  verifyCredentials,
  readSessionToken,
  verifySessionToken,
} = require('../lib/auth');
const { writeEnvPatch, DOTENV_PATH } = require('../lib/env');

// ── Brute-force protection (in-memory sliding window) ────────────────────
// Max 10 failed attempts per IP in a 15-minute window.
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS    = 15 * 60 * 1000; // 15 min

/** @type {Map<string, { count: number, windowStart: number }>} */
const loginAttempts = new Map();

function getClientIp(req) {
  // Trust X-Forwarded-For only if behind a trusted proxy (nginx)
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : null) || req.socket.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 0, windowStart: now });
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const now   = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

function setSessionCookie(res, req, token) {
  // Use Secure only when the request actually arrived over HTTPS (either
  // directly or via a reverse proxy that sets X-Forwarded-Proto).
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const isHttps = proto === 'https' || String(process.env.PORTAL_SECURE_COOKIES || '').toLowerCase() === 'true';
  const attrs = [
    `ps_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isHttps ? 'Secure' : '',
    'Max-Age=28800',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'ps_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

router.get('/config', (_req, res) => {
  res.json({ authEnabled: AUTH_ENABLED, usernameHint: AUTH_USER });
});

router.get('/me', (req, res) => {
  if (!AUTH_ENABLED) {
    return res.json({ authenticated: true, authEnabled: false, user: 'anonymous' });
  }
  const payload = verifySessionToken(readSessionToken(req));
  if (!payload) return res.status(401).json({ authenticated: false, authEnabled: true });
  return res.json({ authenticated: true, authEnabled: true, user: payload.sub });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!AUTH_ENABLED) {
    return res.json({ ok: true, authEnabled: false, user: 'anonymous' });
  }
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  if (!verifyCredentials(String(username || ''), String(password || ''))) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  clearAttempts(ip);
  const token = createSessionToken(String(username));
  setSessionCookie(res, req, token);
  return res.json({ ok: true, authEnabled: true, user: username, mustChangePassword: isDefaultPassword() });
});

router.post('/change-password', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true });
  const payload = verifySessionToken(readSessionToken(req));
  if (!payload) return res.status(401).json({ error: 'Authentication required' });

  const { currentPassword, newPassword } = req.body || {};
  if (!verifyCredentials(String(payload.sub), String(currentPassword || ''))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const np = String(newPassword || '');
  if (np.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  // Persist to .env so it survives restarts.
  writeEnvPatch({ PORTAL_PASS: np }, DOTENV_PATH);
  // Apply immediately without requiring a restart.
  setRuntimePassword(np);
  return res.json({ ok: true });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;
