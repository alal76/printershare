'use strict';

/**
 * Parse raw `lsusb` output into structured device objects.
 * Enhances with known device database for make/model/capability hints.
 */

const KNOWN_DEVICES = require('../data/usb-devices.json');

function parseUsbDevices(lsusbOutput) {
  const devices = [];
  for (const line of lsusbOutput.split('\n')) {
    // Format: Bus 001 Device 003: ID 03f0:2b17 Hewlett-Packard LaserJet Pro M404n
    const m = line.match(/^Bus\s+(\d+)\s+Device\s+(\d+):\s+ID\s+([0-9a-f]{4}):([0-9a-f]{4})\s+(.*)$/i);
    if (!m) continue;
    const [, bus, device, vid, pid, desc] = m;
    const vidpid = `${vid.toLowerCase()}:${pid.toLowerCase()}`;
    const known  = KNOWN_DEVICES[vidpid] || {};
    devices.push({
      bus,
      device,
      vid: vid.toLowerCase(),
      pid: pid.toLowerCase(),
      vidpid,
      name:         known.name || desc.trim() || 'Unknown Device',
      make:         known.make || '',
      model:        known.model || '',
      capabilities: known.capabilities || guessCapabilities(desc, vid, pid),
    });
  }
  return devices;
}

function guessCapabilities(desc, _vid, _pid) {
  const d = desc.toLowerCase();
  return {
    print: d.includes('print') || d.includes('laser') || d.includes('inkjet'),
    scan:  d.includes('scan') || d.includes('lide') || d.includes('perfection'),
    fax:   d.includes('fax'),
    escl:  d.includes('airscan') || d.includes('escl'),
  };
}

module.exports = { parseUsbDevices };
