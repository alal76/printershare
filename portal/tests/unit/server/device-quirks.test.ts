// Beta test version v1.2.0
/**
 * Unit tests for portal/server/lib/device-quirks.js
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { lookup, packagesFor, normalizeVidPid } =
  req('../../../server/lib/device-quirks');

describe('normalizeVidPid', () => {
  it('lowercases and strips 0x prefixes', () => {
    expect(normalizeVidPid('04E8:344F')).toBe('04e8:344f');
    expect(normalizeVidPid('0x04e8:0x344f')).toBe('04e8:344f');
  });
  it('returns empty string for garbage input', () => {
    expect(normalizeVidPid('')).toBe('');
    expect(normalizeVidPid('not-a-vidpid')).toBe('');
    // @ts-expect-error — intentionally invalid input
    expect(normalizeVidPid(null)).toBe('');
  });
});

describe('lookup', () => {
  it('returns an exact match for a catalogued device (Samsung SCX-3400)', () => {
    const r = lookup('04e8:344f');
    expect(r.matched).toBe('exact');
    expect(r.scan.sane_backend).toBe('smfp');
    expect(r.scan.sane_blacklist).toContain('xerox_mfp');
    expect(r.airsane).toBe('ok');
  });

  it('falls back to vendor wildcard when PID is unknown', () => {
    const r = lookup('03f0:1234'); // 03f0 = HP
    expect(r.matched).toBe('vendor');
    expect(r.make).toBe('hp');
  });

  it('falls back to make string when VID:PID is unknown', () => {
    const r = lookup('ffff:ffff', 'Brother');
    expect(r.matched).toBe('make');
    expect(r.print.packages).toContain('printer-driver-brlaser');
  });

  it('returns matched=none for an unknown device with no make hint', () => {
    expect(lookup('ffff:ffff').matched).toBe('none');
  });
});

describe('packagesFor', () => {
  it('combines exact-device and make-level package lists without duplicates', () => {
    const pkgs = packagesFor('04e8:344f', 'Samsung', ['print', 'scan']);
    expect(pkgs).toContain('suld-driver2-1.00.39');
    // dedupe check — same package appears in both print and scan stanzas
    expect(pkgs.filter((p: string) => p === 'suld-driver2-1.00.39')).toHaveLength(1);
  });

  it('returns empty list for an unknown device', () => {
    expect(packagesFor('ffff:ffff', '', ['print', 'scan'])).toEqual([]);
  });
});
