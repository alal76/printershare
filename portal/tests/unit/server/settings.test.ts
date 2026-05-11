// Beta test version v1.2.0
/**
 * Unit tests for server/routes/settings.js
 *
 * The settings route delegates to lib/env.js which reads DOTENV_PATH once
 * at require time. To avoid module-cache issues we test the env helpers
 * directly, and test the route's request parsing separately.
 */

import fs   from 'node:fs';
import path from 'node:path';
import os   from 'node:os';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const req = createRequire(import.meta.url);
// Use lib/env directly — same code the route uses, but we control the path arg
const { readEnv, writeEnvPatch } = req('../../../server/lib/env');

const request = req('supertest');
const express = req('express');

let tmpEnv: string;

beforeEach(() => {
  tmpEnv = path.join(os.tmpdir(), `settings-test-${Date.now()}.env`);
});

afterEach(() => {
  try { fs.unlinkSync(tmpEnv); } catch { /* ignore */ }
});

// ── lib/env integration (same code the route delegates to) ────────────────────
describe('settings env helpers', () => {
  it('returns empty object for missing env file', () => {
    expect(readEnv(tmpEnv, true)).toEqual({});
  });

  it('redacts sensitive keys', () => {
    fs.writeFileSync(tmpEnv, 'SAMBA_PASS=s3cr3t\nFOO=bar\n');
    const result = readEnv(tmpEnv, true);
    expect(result['SAMBA_PASS']).toBe('••••••••');
    expect(result['FOO']).toBe('bar');
  });

  it('writes new keys', () => {
    writeEnvPatch({ FOO: 'bar', BAZ: '42' }, tmpEnv);
    const content = fs.readFileSync(tmpEnv, 'utf8');
    expect(content).toContain('FOO=bar');
    expect(content).toContain('BAZ=42');
  });

  it('updates an existing key', () => {
    fs.writeFileSync(tmpEnv, 'FOO=old\n');
    writeEnvPatch({ FOO: 'new' }, tmpEnv);
    expect(fs.readFileSync(tmpEnv, 'utf8')).toContain('FOO=new');
  });
});

// ── Route request-parsing tests ───────────────────────────────────────────────
function makeApp(envPath: string) {
  const router = express.Router();
  router.get('/', (_req: object, res: { json: (v: unknown) => void }) => res.json(readEnv(envPath, true)));
  router.patch('/', (req2: { body: unknown }, res: { status: (n: number) => { json: (v: unknown) => void }, json: (v: unknown) => void }) => {
    const patch = req2.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return res.status(400).json({ error: 'Expected a JSON object' });
    }
    writeEnvPatch(patch as Record<string, string>, envPath);
    res.json({ ok: true });
  });
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('settings route request validation', () => {
  it('GET returns redacted env', async () => {
    fs.writeFileSync(tmpEnv, 'SAMBA_PASS=secret\nHOST=localhost\n');
    const res = await request(makeApp(tmpEnv)).get('/');
    expect(res.status).toBe(200);
    expect(res.body.SAMBA_PASS).toBe('••••••••');
    expect(res.body.HOST).toBe('localhost');
  });

  it('PATCH returns 400 for array body', async () => {
    const res = await request(makeApp(tmpEnv)).patch('/').send([{ key: 'val' }]);
    expect(res.status).toBe(400);
  });

  it('PATCH writes env and returns ok', async () => {
    const res = await request(makeApp(tmpEnv))
      .patch('/')
      .set('Content-Type', 'application/json')
      .send({ FOO: 'bar' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(fs.readFileSync(tmpEnv, 'utf8')).toContain('FOO=bar');
  });
});
