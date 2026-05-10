'use strict';

/**
 * @module lib/device-lock
 * @description Single-process mutex that mediates ownership of the USB
 * printer/scanner between CUPS and SANE for legacy (non-IPP-over-USB)
 * multi-function devices.
 *
 * The Linux kernel only allows one userspace process to hold a USB
 * interface at a time.  CUPS keeps the interface open while a print
 * queue is enabled, which blocks the SANE backend with "Error during
 * device I/O".  This module:
 *
 *   - Serializes overlapping scan requests behind a Promise chain.
 *   - Calls `cupsdisable -h <queue>` before a scan so CUPS releases
 *     the kernel handle (the `-h` flag waits for any in-flight print
 *     job to finish first, so prints aren't truncated).
 *   - Calls `cupsenable <queue>` after the scan so CUPS reclaims the
 *     device and any spooled jobs resume.
 *
 * For modern IPP-over-USB devices this lock is a no-op: ipp-usb already
 * mediates the kernel handle, so neither cupsd nor SANE touch USB.
 */

const { spawnSync } = require('node:child_process');

/**
 * When `CUPS_LOCAL=1` (native install: portal + cupsd on the same host)
 * we invoke the CUPS CLI directly.  Otherwise we shell into the cups
 * container via `docker exec` (the original Docker-Compose deployment).
 */
const CUPS_LOCAL = process.env.CUPS_LOCAL === '1';
const CUPS_CONTAINER = process.env.CUPS_CONTAINER || 'ps-cups';

/** Sequential lock chain — every withScanLock() awaits the previous one. */
let chain = Promise.resolve();

/**
 * Run a CUPS CLI command (locally or inside the cups container).
 * `args` is the full argv as the user would type it: `['cupsdisable', '-h', q]`.
 * Returns stdout (trimmed) or throws.
 */
function runCups(args, timeout = 10_000) {
  const [cmd, cmdArgs] = CUPS_LOCAL
    ? [args[0], args.slice(1)]
    : ['docker', ['exec', CUPS_CONTAINER, ...args]];
  const r = spawnSync(cmd, cmdArgs, {
    encoding: 'utf8',
    timeout,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error((r.stderr || `exit ${r.status}`).slice(0, 300));
  }
  return (r.stdout || '').trim();
}

/** Best-effort: never throws. */
function tryRunCups(args, timeout) {
  try { return runCups(args, timeout); } catch { return ''; }
}

/** List every CUPS print queue name. */
function listQueues() {
  try {
    const out = runCups(['lpstat', '-p'], 5_000);
    const names = [];
    const re = /^printer (\S+)\s/gm;
    let m;
    while ((m = re.exec(out)) !== null) names.push(m[1]);
    return names;
  } catch { return []; }
}

/** Sleep helper — Promise-based, no busy-wait. */
function sleep(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * Acquire the device lock, hand the USB device from CUPS to SANE, run `fn`,
 * then hand the device back to CUPS.
 *
 * @template T
 * @param {() => Promise<T>} fn  Async work that needs exclusive USB access.
 * @returns {Promise<T>}
 */
function withScanLock(fn) {
  const next = chain.then(async () => {
    const queues = listQueues();
    const disabled = [];
    try {
      // 1) Tell CUPS to release the device.  -h = "hold queue, wait for any
      //    active job to finish".  Most legacy queues will release within ~1 s.
      for (const q of queues) {
        try {
          runCups(['cupsdisable', '-h', q], 30_000);
          disabled.push(q);
        } catch (e) {
          // Disable failed — note and continue; we still try to scan.
          console.warn(`[device-lock] cupsdisable ${q} failed: ${e.message}`);
        }
      }

      // 2) Brief pause so the kernel actually releases the handle.
      await sleep(1500);

      // 3) Run the scan (or other USB-claiming work).
      return await fn();
    } finally {
      // 4) Always re-enable queues so the printer remains usable.
      for (const q of disabled) {
        tryRunCups(['cupsenable', q], 5_000);
      }
    }
  });

  // Keep the chain alive even if this job errored.
  chain = next.catch(() => undefined);
  return next;
}

module.exports = { withScanLock, listQueues };
