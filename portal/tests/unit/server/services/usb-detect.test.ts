// Beta test version v1.2.0
/**
 * Unit tests for server/services/usb-detect.js
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { parseUsbDevices } = req('../../../../server/services/usb-detect');

const LSUSB_SAMPLE = `
Bus 001 Device 003: ID 03f0:2b17 Hewlett-Packard LaserJet Pro M404n
Bus 001 Device 005: ID 04b8:013c Seiko Epson Corp. Perfection V39
Bus 001 Device 007: ID 04a9:1912 Canon, Inc. LiDE 300
Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
`.trim();

describe('parseUsbDevices', () => {
  it('returns empty array for empty input', () => {
    expect(parseUsbDevices('')).toEqual([]);
  });

  it('parses HP LaserJet as printer (via guessCapabilities)', () => {
    const devices = parseUsbDevices(LSUSB_SAMPLE);
    const hp = devices.find((d: { vid: string }) => d.vid === '03f0');
    expect(hp).toBeDefined();
    expect(hp.capabilities.print).toBe(true);
  });

  it('parses Epson scanner capabilities', () => {
    const devices = parseUsbDevices(LSUSB_SAMPLE);
    const epson = devices.find((d: { vid: string }) => d.vid === '04b8');
    expect(epson).toBeDefined();
    expect(epson.capabilities.scan).toBe(true);
  });

  it('parses Canon LiDE scanner', () => {
    const devices = parseUsbDevices(LSUSB_SAMPLE);
    const canon = devices.find((d: { pid: string }) => d.pid === '1912');
    expect(canon).toBeDefined();
    expect(canon.capabilities.scan).toBe(true);
  });

  it('includes vidpid in expected format', () => {
    const devices = parseUsbDevices('Bus 001 Device 003: ID 03f0:2b17 HP Printer');
    expect(devices[0].vidpid).toBe('03f0:2b17');
  });

  it('includes bus and device fields', () => {
    const devices = parseUsbDevices('Bus 002 Device 009: ID 03f0:2b17 HP Printer');
    expect(devices[0].bus).toBe('002');
    expect(devices[0].device).toBe('009');
  });
});
