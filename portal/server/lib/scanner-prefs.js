// Beta test version v1.2.0
'use strict';

/**
 * @module lib/scanner-prefs
 * @description Persists the user's chosen "default scanner" device id.
 *
 * SANE/scanservjs has no native concept of a default device — unlike CUPS,
 * which tracks a default printer via `lpadmin -d`. When more than one
 * scanner is attached, scanservjs' `/api/v1/context` simply returns
 * whatever it enumerates first, which is not stable across reboots or
 * USB re-enumeration. This module lets the portal remember an explicit
 * choice and prefer it when present.
 */

const fs   = require('node:fs');
const path = require('node:path');

function prefsPath() {
  const dataDir = process.env.PORTAL_DATA_DIR || '/app/data';
  return path.join(dataDir, 'scanner-prefs.json');
}

/** @returns {{ defaultScanner: string | null }} */
function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
  } catch {
    return { defaultScanner: null };
  }
}

/** @param {string | null} device */
function setDefaultScanner(device) {
  const dataDir = process.env.PORTAL_DATA_DIR || '/app/data';
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify({ defaultScanner: device || null }, null, 2));
}

/** @returns {string | null} */
function getDefaultScanner() {
  return readPrefs().defaultScanner ?? null;
}

module.exports = { getDefaultScanner, setDefaultScanner };
