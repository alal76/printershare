// Beta test version v1.2.0
/**
 * Unit tests for portal/server/lib/env.js
 */

import fs   from 'node:fs';
import path from 'node:path';
import os   from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { readEnv, writeEnvPatch } = req('../../../server/lib/env');

let tmpFile: string;

beforeEach(() => {
  tmpFile = path.join(os.tmpdir(), `env-test-${Date.now()}.env`);
});

afterEach(() => {
  try { fs.unlinkSync(tmpFile); } catch { /* already removed */ }
});

describe('readEnv', () => {
  it('returns empty object for missing file', () => {
    expect(readEnv('/nonexistent/path/.env')).toEqual({});
  });

  it('parses key=value lines', () => {
    fs.writeFileSync(tmpFile, 'FOO=bar\nBAZ=qux\n');
    expect(readEnv(tmpFile)).toMatchObject({ FOO: 'bar', BAZ: 'qux' });
  });

  it('ignores comment lines and blank lines', () => {
    fs.writeFileSync(tmpFile, '# comment\n\nFOO=bar\n');
    expect(readEnv(tmpFile)).toEqual({ FOO: 'bar' });
  });

  it('redacts sensitive keys when redact=true', () => {
    fs.writeFileSync(tmpFile, 'SAMBA_PASS=secret\nSERVER_HOST=localhost\n');
    const result = readEnv(tmpFile, true);
    expect(result['SAMBA_PASS']).toBe('••••••••');
    expect(result['SERVER_HOST']).toBe('localhost');
  });

  it('does not redact when redact=false (default)', () => {
    fs.writeFileSync(tmpFile, 'SAMBA_PASS=secret\n');
    expect(readEnv(tmpFile)['SAMBA_PASS']).toBe('secret');
  });
});

describe('writeEnvPatch', () => {
  it('creates a new file if it does not exist', () => {
    writeEnvPatch({ FOO: 'bar' }, tmpFile);
    expect(fs.readFileSync(tmpFile, 'utf8')).toContain('FOO=bar');
  });

  it('updates an existing key', () => {
    fs.writeFileSync(tmpFile, 'FOO=old\n');
    writeEnvPatch({ FOO: 'new' }, tmpFile);
    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toContain('FOO=new');
    expect(content).not.toContain('FOO=old');
  });

  it('appends a new key', () => {
    fs.writeFileSync(tmpFile, 'FOO=bar\n');
    writeEnvPatch({ BAZ: 'qux' }, tmpFile);
    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toContain('FOO=bar');
    expect(content).toContain('BAZ=qux');
  });

  it('sanitises unsafe characters in keys', () => {
    writeEnvPatch({ 'my-key!': 'val' }, tmpFile);
    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toContain('my_key_=val');
  });

  it('strips newlines from values', () => {
    writeEnvPatch({ K: 'line1\nline2' }, tmpFile);
    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toContain('K=line1line2');
    expect(content).not.toContain('\nline2');
  });
});
