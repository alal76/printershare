'use strict';

/**
 * @module lib/device-quirks
 * @description Lookup helper for the device-quirks catalogue.
 *
 * The catalogue (data/device-quirks.json) maps a USB VID:PID (or VID:* glob)
 * to a per-device record describing:
 *   - recommended PPD / print packages
 *   - SANE backend + packages, plus backends that must be blacklisted
 *   - whether ipp-usb / AirSane are known to work
 *   - free-text notes
 *
 * Resolution order for `lookup(vidpid, make)`:
 *   1. Exact "vid:pid" match.
 *   2. Vendor wildcard "vid:*" match.
 *   3. `fallbacks[make]` by lowercase make string.
 *   4. Empty record (`{}`).
 *
 * The catalogue is loaded once at module init; restart the portal to pick
 * up edits. This is deliberate — the file ships in-tree and is part of the
 * release artifact.
 */

const fs   = require('node:fs');
const path = require('node:path');

const CATALOGUE_PATH = path.join(__dirname, '..', 'data', 'device-quirks.json');

let _catalogue = null;
/** @returns {{ version: number, devices: Record<string, object>, fallbacks: Record<string, object> }} */
function catalogue() {
  if (_catalogue) return _catalogue;
  try {
    _catalogue = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf8'));
  } catch (err) {
    // Fail soft — quirks are advisory, never block the wizard if the file is missing.
    _catalogue = { version: 0, devices: {}, fallbacks: {} };
    process.stderr.write(`device-quirks: failed to load catalogue: ${err.message}\n`);
  }
  return _catalogue;
}

/**
 * Normalise a USB ID string to lowercase "vid:pid" form. Accepts:
 *   "04E8:344F"  →  "04e8:344f"
 *   "04e8:344f"  →  "04e8:344f"
 *   "0x04e8:0x344f" → "04e8:344f"
 *   anything else → ""
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeVidPid(raw) {
  if (typeof raw !== 'string') return '';
  const m = /(?:0x)?([0-9a-f]{4})\s*[:_-]\s*(?:0x)?([0-9a-f]{4})/.exec(raw.toLowerCase());
  return m ? `${m[1]}:${m[2]}` : '';
}

/**
 * Look up a quirks record for a device.
 *
 * @param {string} vidpid - USB VID:PID (any case, optional 0x prefixes).
 * @param {string} [make] - Free-text make string for fallback ("HP", "samsung", etc.).
 * @returns {{
 *   matched:        'exact' | 'vendor' | 'make' | 'none',
 *   key:            string,
 *   name?:          string,
 *   make?:          string,
 *   kind?:          'printer' | 'scanner' | 'mfp' | 'auto',
 *   print?:         { ppd?: string, packages?: string[], uri_hint?: string },
 *   scan?:          { sane_backend?: string, sane_blacklist?: string[], packages?: string[] },
 *   ipp_usb?:       boolean,
 *   airsane?:       'ok' | 'broken' | 'untested',
 *   notes?:         string,
 * }}
 */
function lookup(vidpid, make) {
  const cat  = catalogue();
  const norm = normalizeVidPid(vidpid);

  if (norm && cat.devices[norm]) {
    return { matched: 'exact', key: norm, ...cat.devices[norm] };
  }
  if (norm) {
    const vendorKey = `${norm.split(':')[0]}:*`;
    if (cat.devices[vendorKey]) {
      return { matched: 'vendor', key: vendorKey, ...cat.devices[vendorKey] };
    }
  }
  const mk = (make || '').toLowerCase().trim();
  if (mk && cat.fallbacks[mk]) {
    return { matched: 'make', key: mk, make: mk, ...cat.fallbacks[mk] };
  }
  return { matched: 'none', key: '' };
}

/**
 * Collect package names from a quirks record (or fallback record) for the
 * requested capabilities into the given Set.
 *
 * @param {object | undefined} record
 * @param {('print'|'scan')[]} capabilities
 * @param {Set<string>} out
 */
function collectPackages(record, capabilities, out) {
  if (!record) return;
  for (const cap of capabilities) {
    const pkgs = record[cap]?.packages;
    if (Array.isArray(pkgs)) for (const p of pkgs) out.add(p);
  }
}

/**
 * Convenience helper: return apt packages to install for the requested
 * capabilities. Combines exact-device + fallback-by-make results.
 *
 * @param {string} vidpid
 * @param {string} make
 * @param {('print'|'scan')[]} capabilities
 * @returns {string[]} deduplicated list of package names
 */
function packagesFor(vidpid, make, capabilities) {
  const record = lookup(vidpid, make);
  const out = new Set();
  collectPackages(record, capabilities, out);
  // Always merge make-level fallbacks even when an exact match was found —
  // exact records may omit packages that the family-wide entry covers.
  if (record.matched !== 'make' && make) {
    collectPackages(catalogue().fallbacks?.[make.toLowerCase()], capabilities, out);
  }
  return [...out];
}

module.exports = { lookup, packagesFor, normalizeVidPid };
