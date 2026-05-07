'use strict';

const router = require('express').Router();
const {
  AUTH_ENABLED,
  AUTH_USER,
  createSessionToken,
  verifyCredentials,
  readSessionToken,
  verifySessionToken,
} = require('../lib/auth');

function setSessionCookie(res, token) {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const attrs = [
    `ps_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isProd ? 'Secure' : '',
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
  if (!verifyCredentials(String(username || ''), String(password || ''))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = createSessionToken(String(username));
  setSessionCookie(res, token);
  return res.json({ ok: true, authEnabled: true, user: username });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;
