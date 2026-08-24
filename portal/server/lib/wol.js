// Beta test version v1.2.0
'use strict';

/**
 * @module lib/wol
 * @description Wake-on-LAN for network printers/scanners: resolve a host's
 * MAC address (kernel neighbor table, ping-to-refresh, then a small
 * on-disk cache for when the device is too asleep to answer ARP at all),
 * and send the standard magic packet as a UDP broadcast.
 *
 * `wakeIfUnreachable()` is the entry point actually used by callers: it's a
 * no-op (skips straight past MAC resolution and the packet) whenever a
 * quick TCP probe shows the device already responding, so the common
 * already-awake case costs one short probe, not a MAC lookup + packet send
 * on every single job.
 */

const dgram = require('node:dgram');
const net   = require('node:net');
const fs    = require('node:fs');
const path  = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeLogger } = require('./logger');

const log = makeLogger('wol');

function macCachePath() {
  const dataDir = process.env.PORTAL_DATA_DIR || '/app/data';
  return path.join(dataDir, 'wol-mac-cache.json');
}

function readMacCache() {
  try {
    return JSON.parse(fs.readFileSync(macCachePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeMacCache(cache) {
  try {
    const p = macCachePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(cache, null, 2));
  } catch { /* best-effort — losing the cache just means slower future wakes */ }
}

const MAC_RE = /([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i;

/**
 * Look up `ip` in the kernel's neighbor (ARP) table.
 * @param {string} ip
 * @returns {string | null} lowercase colon-separated MAC, or null
 */
function neighborLookup(ip) {
  const r = spawnSync('ip', ['neigh', 'show', ip], { encoding: 'utf8', timeout: 3000 });
  const m = MAC_RE.exec(r.stdout || '');
  return m ? m[1].toLowerCase() : null;
}

/**
 * Resolve `ip`'s MAC address: check the neighbor table, and if it's not
 * there (or stale), ping once to prompt an ARP exchange and check again.
 * A sleeping-but-not-fully-off device usually still answers ARP even when
 * it won't answer the actual print/scan protocol yet.
 * @param {string} ip
 * @returns {string | null}
 */
function resolveMac(ip) {
  const direct = neighborLookup(ip);
  if (direct) return direct;
  spawnSync('ping', ['-c', '1', '-W', '1', ip], { timeout: 3000 });
  return neighborLookup(ip);
}

/**
 * Resolve `ip`'s MAC, preferring a fresh live lookup but falling back to
 * the last one seen — a genuinely sleeping device may not answer ARP at
 * all, which is exactly the moment the cached value matters most.
 * @param {string} ip
 * @returns {string | null}
 */
function resolveMacWithCache(ip) {
  const cache = readMacCache();
  const live = resolveMac(ip);
  if (live) {
    if (cache[ip] !== live) {
      cache[ip] = live;
      writeMacCache(cache);
    }
    return live;
  }
  return cache[ip] || null;
}

/**
 * Send a standard Wake-on-LAN magic packet: 6 bytes of 0xFF followed by
 * the target MAC repeated 16 times, as a UDP broadcast. No raw sockets or
 * special privileges needed — this is the ordinary consumer-router-legal
 * form of WOL.
 * @param {string} mac
 * @param {number} [port=9]
 * @returns {Promise<void>}
 */
function sendMagicPacket(mac, port = 9) {
  return new Promise((resolve, reject) => {
    const bytes = mac.split(':').map(b => Number.parseInt(b, 16));
    if (bytes.length !== 6 || bytes.some(b => Number.isNaN(b))) {
      reject(new Error(`Invalid MAC address: ${mac}`));
      return;
    }
    const packet = Buffer.alloc(6 + 16 * 6, 0xff);
    const macBuf = Buffer.from(bytes);
    for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);

    const socket = dgram.createSocket('udp4');
    socket.once('error', err => { socket.close(); reject(err); });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, port, '255.255.255.255', err => {
        socket.close();
        if (err) reject(err); else resolve();
      });
    });
  });
}

/**
 * Quick, bounded TCP-connect probe — just "is anything answering on this
 * port", not a protocol-level check.
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs=300]
 * @returns {Promise<boolean>}
 */
function quickProbe(host, port, timeoutMs = 300) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/**
 * Best-effort auto-WOL: if `host:port` doesn't answer a quick probe,
 * resolve its MAC and send a magic packet, then poll briefly for it to
 * come up. Never throws — a printer that's genuinely powered off, on a
 * different subnet than expected, or doesn't support WOL just fails the
 * subsequent print/scan submission normally, exactly as it would without
 * this ever having run.
 * @param {string} host
 * @param {number} port
 * @returns {Promise<{ attempted: boolean, mac: string|null, wokeUp: boolean }>}
 */
async function wakeIfUnreachable(host, port) {
  if (await quickProbe(host, port)) {
    return { attempted: false, mac: null, wokeUp: false };
  }

  const mac = resolveMacWithCache(host);
  if (!mac) {
    log.warn('device unreachable and no MAC on file — cannot send WOL', { host, port });
    return { attempted: false, mac: null, wokeUp: false };
  }

  try {
    await sendMagicPacket(mac);
    log.info('sent WOL magic packet', { host, mac });
  } catch (err) {
    log.warn('failed to send WOL packet', { host, mac, error: err.message });
    return { attempted: true, mac, wokeUp: false };
  }

  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await quickProbe(host, port)) {
      return { attempted: true, mac, wokeUp: true };
    }
  }
  return { attempted: true, mac, wokeUp: false };
}

module.exports = {
  resolveMac, resolveMacWithCache, sendMagicPacket, quickProbe, wakeIfUnreachable,
};
