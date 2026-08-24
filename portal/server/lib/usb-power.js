// Beta test version v1.2.0
'use strict';

/**
 * @module lib/usb-power
 * @description Wake a USB printer/scanner from Linux's runtime USB
 * autosuspend before a job is submitted to it.
 *
 * Kernel I/O normally resumes an autosuspended USB device transparently —
 * the driver's next transfer just blocks briefly while the port powers
 * back up — so this mostly exists to do that resume *before* a print/scan
 * submission rather than mid-job, and to have something concrete to check
 * and log when a device that should be there isn't responding.
 */

const fs   = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseUsbDevices } = require('../services/usb-detect');
const { makeLogger } = require('./logger');

const log = makeLogger('usb-power');

/**
 * Find the /sys/bus/usb/devices/* entry matching an lsusb bus/device pair.
 * @param {string} bus     e.g. "001" (lsusb's zero-padded bus number)
 * @param {string} device  e.g. "003" (lsusb's zero-padded device number)
 * @returns {string | null} absolute sysfs path, or null if not found
 */
function findSysfsPath(bus, device) {
  const base = '/sys/bus/usb/devices';
  let entries;
  try {
    entries = fs.readdirSync(base);
  } catch {
    return null;
  }
  const wantBus = Number.parseInt(bus, 10);
  const wantDev = Number.parseInt(device, 10);
  for (const entry of entries) {
    const dir = path.join(base, entry);
    try {
      const busnum = Number.parseInt(fs.readFileSync(path.join(dir, 'busnum'), 'utf8'), 10);
      const devnum = Number.parseInt(fs.readFileSync(path.join(dir, 'devnum'), 'utf8'), 10);
      if (busnum === wantBus && devnum === wantDev) return dir;
    } catch {
      // Not every entry under /sys/bus/usb/devices is a device node (some
      // are interfaces, e.g. "1-2:1.0") — those don't have busnum/devnum
      // and are expected to fail here.
    }
  }
  return null;
}

/**
 * @param {string} sysfsPath
 * @returns {'suspended' | 'active' | null}
 */
function getRuntimeStatus(sysfsPath) {
  try {
    return fs.readFileSync(path.join(sysfsPath, 'power', 'runtime_status'), 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Find the currently-attached USB device offering `capability` ('print' or
 * 'scan') via `lsusb` + the same parsing the Devices page uses, and make
 * sure it isn't runtime-suspended before the caller talks to it.
 *
 * @param {'print' | 'scan'} capability
 * @returns {{ present: boolean, wasAsleep: boolean, vidpid: string | null }}
 */
function wakeAttachedUsbDevice(capability) {
  const lsusb = spawnSync('lsusb', [], { encoding: 'utf8', timeout: 5000 });
  if (lsusb.status !== 0 || !lsusb.stdout) {
    return { present: false, wasAsleep: false, vidpid: null };
  }

  const target = parseUsbDevices(lsusb.stdout).find(d => d.capabilities?.[capability]);
  if (!target) return { present: false, wasAsleep: false, vidpid: null };

  const sysfsPath = findSysfsPath(target.bus, target.device);
  if (!sysfsPath) return { present: true, wasAsleep: false, vidpid: target.vidpid };

  const wasAsleep = getRuntimeStatus(sysfsPath) === 'suspended';
  if (wasAsleep) {
    try {
      fs.writeFileSync(path.join(sysfsPath, 'power', 'control'), 'on');
      log.info('resumed suspended USB device', { vidpid: target.vidpid, capability });
    } catch (err) {
      log.warn('failed to resume USB device', { vidpid: target.vidpid, error: err.message });
    }
    // Brief bounded wait for the device to actually come back before the
    // caller hits it with a real print/scan transfer. Matches the
    // busy-wait style already used for USB handoff in lib/device-lock.js.
    const until = Date.now() + 800;
    while (Date.now() < until) { /* spin */ }
  }

  return { present: true, wasAsleep, vidpid: target.vidpid };
}

module.exports = { wakeAttachedUsbDevice, findSysfsPath, getRuntimeStatus };
