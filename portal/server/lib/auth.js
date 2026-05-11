// Beta test version v1.2.0
'use strict';

const crypto = require('node:crypto');

// Auth is DISABLED by default. Set PORTAL_AUTH=true to require login.
let _authEnabled = String(process.env.PORTAL_AUTH ?? 'false').toLowerCase() === 'true';

/** Toggle login enforcement at runtime (no restart needed). */
function setRuntimeAuth(enabled) {
  _authEnabled = Boolean(enabled);
}
const AUTH_USER = process.env.PORTAL_USER || 'admin';
const DEFAULT_PASS = 'changeme';
// Runtime-mutable so a change-password call takes effect without a restart.
let AUTH_PASS = process.env.PORTAL_PASS || process.env.PORTAL_SECRET || DEFAULT_PASS;
const AUTH_SECRET = process.env.PORTAL_SECRET || 'changeme-portal-secret';

/** Returns true if the password is still the factory default. */
function isDefaultPassword() {
  return AUTH_PASS === DEFAULT_PASS;
}

/** Update the in-process password (call after persisting to .env). */
function setRuntimePassword(newPass) {
  AUTH_PASS = newPass;
}
const SESSION_TTL_SECONDS = Number.parseInt(process.env.PORTAL_SESSION_TTL || '28800', 10); // 8h

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
}

function createSessionToken(username) {
  const payload = {
    sub: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64);
  // Timing-safe comparison prevents HMAC length/timing oracle attacks.
  const sigBuf      = Buffer.from(sig,      'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload?.sub || !payload?.exp) return null;
    if (Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function readSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.ps_session) return cookies.ps_session;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function verifyCredentials(username, password) {
  return username === AUTH_USER && password === AUTH_PASS;
}

module.exports = {
  get AUTH_ENABLED() { return _authEnabled; },
  AUTH_USER,
  get AUTH_PASS() { return AUTH_PASS; },
  SESSION_TTL_SECONDS,
  isDefaultPassword,
  setRuntimePassword,
  setRuntimeAuth,
  createSessionToken,
  verifySessionToken,
  readSessionToken,
  verifyCredentials,
};
