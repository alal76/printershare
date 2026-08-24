// Beta test version v1.2.0
'use strict';

/**
 * @module lib/device-wake
 * @description Single entry point print/scan submission code calls to make
 * sure the target device is actually awake first — dispatches to the
 * right mechanism for the URI/device-id shape it's given:
 *
 *   - `usb://...` printer URIs, and SANE device ids embedding a USB
 *     vid;pid (e.g. `smfp:usb;04e8;344f;SERIAL`) → lib/usb-power.js
 *     (resume from Linux's runtime USB autosuspend).
 *   - `ipp(s)://`, `socket://`, `lpd://` printer URIs → lib/wol.js
 *     (Wake-on-LAN magic packet, only if a quick probe shows it's not
 *     already answering).
 *
 * Network (eSCL/WSD) scanners are intentionally not covered here — the
 * SANE device id for one doesn't reliably carry back its network address,
 * and heuristically matching it against the static network-scanner
 * registry by name is fragile enough that a wrong match (skipping a wake
 * that was needed, or worse, sending WOL to the wrong host) is worse than
 * doing nothing. USB and CUPS-known network printers cover the common
 * cases reliably; this one doesn't get to be a guess.
 *
 * Every function here is best-effort and never throws — a failed wake
 * attempt just means the subsequent print/scan submission fails normally,
 * exactly as it would have without this ever running.
 */

const { wakeIfUnreachable } = require('./wol');
const { wakeAttachedUsbDevice } = require('./usb-power');
const { makeLogger } = require('./logger');

const log = makeLogger('device-wake');

/** @param {string} uri @returns {{ host: string, port: number } | null} */
function parseNetworkPrinterTarget(uri) {
  const m = /^(ipps?|socket|lpd):\/\/([^:/?]+)(?::(\d+))?/.exec(uri || '');
  if (!m) return null;
  const scheme = m[1];
  const defaultPort = scheme === 'socket' ? 9100 : scheme === 'lpd' ? 515 : 631;
  return { host: m[2], port: m[3] ? Number.parseInt(m[3], 10) : defaultPort };
}

/**
 * @param {string} uri  CUPS device URI, e.g. from `lpstat -v`.
 * @returns {Promise<{ mechanism: 'usb' | 'wol' | 'none', woke: boolean }>}
 */
async function ensureAwakeForPrinterUri(uri) {
  if (!uri) return { mechanism: 'none', woke: false };

  if (uri.startsWith('usb://')) {
    const result = wakeAttachedUsbDevice('print');
    if (result.wasAsleep) log.info('woke USB printer before job', { vidpid: result.vidpid });
    return { mechanism: 'usb', woke: result.wasAsleep };
  }

  const target = parseNetworkPrinterTarget(uri);
  if (!target) return { mechanism: 'none', woke: false };

  const result = await wakeIfUnreachable(target.host, target.port);
  if (result.attempted) {
    log.info('WOL attempted before print job', { host: target.host, wokeUp: result.wokeUp });
  }
  return { mechanism: 'wol', woke: result.wokeUp };
}

const USB_SCAN_ID_RE = /usb[;:]([0-9a-f]{4})[;:]([0-9a-f]{4})/i;

/**
 * @param {string} deviceId  SANE device id, e.g. from scanservjs's /context.
 * @returns {{ mechanism: 'usb' | 'none', woke: boolean }}
 */
function ensureAwakeForScanDevice(deviceId) {
  if (!deviceId || !USB_SCAN_ID_RE.test(deviceId)) return { mechanism: 'none', woke: false };

  const result = wakeAttachedUsbDevice('scan');
  if (result.wasAsleep) log.info('woke USB scanner before job', { vidpid: result.vidpid });
  return { mechanism: 'usb', woke: result.wasAsleep };
}

module.exports = { ensureAwakeForPrinterUri, ensureAwakeForScanDevice, parseNetworkPrinterTarget };
