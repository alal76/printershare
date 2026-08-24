// Beta test version v1.2.0
'use strict';

/**
 * @module lib/network-scanner
 * @description Reads/writes the `[devices]` section of sane-airscan's
 * config file (`/etc/sane.d/airscan.conf`) to statically register a
 * standalone network scanner.
 *
 * sane-airscan (already installed — it's the `escl` backend in
 * /etc/sane.d/dll.conf) auto-discovers eSCL/WSD scanners on the local
 * broadcast domain via mDNS with zero configuration. This module covers
 * the case that doesn't: a scanner on a different subnet/VLAN, or on a
 * network where mDNS discovery is unreliable — per `sane-airscan(5)`,
 * exactly what the `[devices]` section is for.
 *
 * Format (see `man sane-airscan`):
 *   [devices]
 *   "Kyocera eSCL" = http://192.168.1.102:9095/eSCL, eSCL
 *   "Kyocera WSD"  = http://192.168.1.102:5358/WSDScanner, WSD
 */

const fs = require('node:fs');

function confPath() {
  return process.env.AIRSCAN_CONF_PATH || '/etc/sane.d/airscan.conf';
}

const DEVICE_LINE_RE = /^\s*(?:"([^"]*)"|(\S+))\s*=\s*(.+?)\s*$/;

function readLines() {
  try {
    return fs.readFileSync(confPath(), 'utf8').split('\n');
  } catch {
    // sane-airscan ships this file by default; only missing if the
    // package itself isn't installed. Start from a minimal skeleton.
    return ['[devices]', '[options]', '[debug]', '[blacklist]'];
  }
}

function writeLines(lines) {
  fs.writeFileSync(confPath(), lines.join('\n'));
}

/** Find the `[section]` line range: { start, end } (end exclusive), or null. */
function findSection(lines, name) {
  const start = lines.findIndex(l => l.trim().toLowerCase() === `[${name}]`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[[a-z]+\]\s*$/i.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

/** Strip an inline `# ...` / `; ...` comment, per airscan.conf's INI-like syntax. */
function stripComment(raw) {
  const idx = raw.search(/[#;]/);
  return (idx >= 0 ? raw.slice(0, idx) : raw).trim();
}

/**
 * @returns {{ name: string, url: string, protocol: string, disabled: boolean }[]}
 */
function listNetworkScanners() {
  const lines = readLines();
  const sec = findSection(lines, 'devices');
  if (!sec) return [];
  const out = [];
  for (let i = sec.start + 1; i < sec.end; i++) {
    const m = DEVICE_LINE_RE.exec(lines[i]);
    if (!m) continue;
    const name = m[1] ?? m[2];
    const value = stripComment(m[3]);
    if (/^disable$/i.test(value)) {
      out.push({ name, url: '', protocol: '', disabled: true });
      continue;
    }
    const [url, protocolRaw] = value.split(',').map(s => s.trim());
    out.push({ name, url, protocol: protocolRaw || 'eSCL', disabled: false });
  }
  return out;
}

/**
 * Add or update a statically-configured network scanner.
 * @param {string} name      Display name (used as the config key).
 * @param {string} url       eSCL root URL or WSD device URL.
 * @param {'eSCL'|'WSD'} protocol
 */
function addNetworkScanner(name, url, protocol) {
  const lines = readLines();
  let sec = findSection(lines, 'devices');
  if (!sec) {
    lines.unshift('[devices]');
    sec = { start: 0, end: 1 };
  }
  const newLine = `  "${name}" = ${url}, ${protocol}`;
  let replaced = false;
  for (let i = sec.start + 1; i < sec.end; i++) {
    const m = DEVICE_LINE_RE.exec(lines[i]);
    if (m && (m[1] ?? m[2]) === name) {
      lines[i] = newLine;
      replaced = true;
      break;
    }
  }
  if (!replaced) lines.splice(sec.end, 0, newLine);
  writeLines(lines);
}

/**
 * Remove a statically-configured network scanner by name.
 * @param {string} name
 * @returns {boolean} true if an entry was found and removed.
 */
function removeNetworkScanner(name) {
  const lines = readLines();
  const sec = findSection(lines, 'devices');
  if (!sec) return false;
  for (let i = sec.start + 1; i < sec.end; i++) {
    const m = DEVICE_LINE_RE.exec(lines[i]);
    if (m && (m[1] ?? m[2]) === name) {
      lines.splice(i, 1);
      writeLines(lines);
      return true;
    }
  }
  return false;
}

module.exports = { listNetworkScanners, addNetworkScanner, removeNetworkScanner };
