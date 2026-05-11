// Beta test version v1.2.0
'use strict';

/**
 * Parse raw `lsusb` output into structured device objects.
 * Enhances with known device database for make/model/capability hints.
 */

const KNOWN_DEVICES = require('../data/usb-devices.json');

/** USB vendor IDs of well-known printer/MFP manufacturers. */
const PRINTER_VENDOR_IDS = new Set([
  '03f0', // HP
  '04a9', // Canon
  '04b8', // Epson
  '04e8', // Samsung
  '04f9', // Brother
  '0482', // Kyocera
  '043d', // Lexmark
  '0924', // Xerox
  '05ca', // Ricoh
  '0a5f', // Zebra
  '067b', // Prolific (USB→parallel adapters often used with printers)
]);

/**
 * Parse `lsusb` output into structured device objects.
 *
 * @param {string} lsusbOutput Raw `lsusb` stdout.
 * @param {object} [enrich]   Optional cross-reference data from authoritative
 *                            sources (CUPS, SANE) used to set capabilities
 *                            when the device is not in KNOWN_DEVICES.
 * @param {string[]} [enrich.cupsPrinterMakes] Lowercased make strings from
 *                            CUPS `lpinfo -v` `usb://<Make>/<Model>` URIs.
 * @param {Array<{bus:string,device:string}>} [enrich.saneUsbDevices]
 *                            Bus/device pairs reported by `scanimage -L`
 *                            (libusb backends).
 */
function parseUsbDevices(lsusbOutput, enrich = {}) {
  const cupsMakes = (enrich.cupsPrinterMakes || []).map(s => String(s).toLowerCase());
  const saneIds   = new Set((enrich.saneUsbDevices || []).map(p => `${p.bus}:${p.device}`));

  const devices = [];
  const re = /^Bus\s+(\d+)\s+Device\s+(\d+):\s+ID\s+([0-9a-f]{4}):([0-9a-f]{4})\s+(.*)$/i;
  for (const line of lsusbOutput.split('\n')) {
    // Format: Bus 001 Device 003: ID 03f0:2b17 Hewlett-Packard LaserJet Pro M404n
    const m = re.exec(line);
    if (!m) continue;
    const [, bus, device, vid, pid, desc] = m;
    const vidpid = `${vid.toLowerCase()}:${pid.toLowerCase()}`;
    const known  = KNOWN_DEVICES[vidpid] || {};
    const baseCaps = known.capabilities || guessCapabilities(desc, vid, pid);
    const caps = { ...baseCaps };

    // Enrich with authoritative data from CUPS (printers) and SANE (scanners).
    const descLc = desc.toLowerCase();
    const makeLc = (known.make || '').toLowerCase();
    if (cupsMakes.some(mk => mk && (descLc.includes(mk) || (makeLc && makeLc === mk)))) {
      caps.print = true;
    }
    if (saneIds.has(`${bus}:${device}`)) {
      caps.scan = true;
    }

    devices.push({
      bus,
      device,
      vid: vid.toLowerCase(),
      pid: pid.toLowerCase(),
      vidpid,
      name:         known.name || desc.trim() || 'Unknown Device',
      make:         known.make || '',
      model:        known.model || '',
      capabilities: caps,
    });
  }
  return devices;
}

function guessCapabilities(desc, vid, _pid) {
  const d = desc.toLowerCase();
  const isPrinterVendor = PRINTER_VENDOR_IDS.has(String(vid).toLowerCase());
  // For known printer-vendor devices, treat USB descriptor keywords broadly:
  // many MFPs (e.g. Samsung SCX, Brother MFC, HP OfficeJet) don't contain the
  // word "printer" in their lsusb description.
  const printerKeyword =
    d.includes('print') || d.includes('laser') || d.includes('inkjet') ||
    /\b(scx|mfp|mfc|dcp|hl-?\d|ml-?\d|officejet|deskjet|laserjet|ecotank|pixma)\b/.test(d);
  const scannerKeyword =
    d.includes('scan') || d.includes('lide') || d.includes('perfection') ||
    /\b(scx|mfp|mfc|dcp|cano)\b/.test(d);
  return {
    print: printerKeyword || (isPrinterVendor && /\b(scx|mfp|mfc|dcp|hl|ml|series)\b/.test(d)),
    scan:  scannerKeyword,
    fax:   d.includes('fax'),
    escl:  d.includes('airscan') || d.includes('escl'),
  };
}

module.exports = { parseUsbDevices };
