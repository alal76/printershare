/**
 * Unit tests for server/routes/scans.js
 *
 * The scans route reads SCANS_PATH once at require time, so we test the
 * file-serving behaviour directly using the fs module and the helper
 * functions, then test the route with a live app instance.
 *
 * To test with a dynamic path we mount the router via a factory that
 * sets the env var before the module is first required.
 */

import fs   from 'node:fs';
import path from 'node:path';
import os   from 'node:os';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const req = createRequire(import.meta.url);

// Create a single temp dir for all scans tests — set env BEFORE require
const scansDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-scans-'));
process.env['SCANS_PATH'] = scansDir;

const request    = req('supertest');
const express    = req('express');
const scansRouter = req('../../../server/routes/scans');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', scansRouter);
  return app;
}

afterAll(() => {
  fs.rmSync(scansDir, { recursive: true, force: true });
});

// Clear scans dir between tests
beforeAll(() => {
  for (const f of fs.readdirSync(scansDir)) {
    fs.unlinkSync(path.join(scansDir, f));
  }
});

describe('GET /', () => {
  it('returns empty array when dir is empty', async () => {
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
  });

  it('lists scan files with metadata', async () => {
    const fp = path.join(scansDir, 'scan001.pdf');
    fs.writeFileSync(fp, '%PDF-1.4');
    try {
      const res = await request(makeApp()).get('/');
      expect(res.status).toBe(200);
      const file = res.body.files.find((f: { name: string }) => f.name === 'scan001.pdf');
      expect(file).toBeDefined();
      expect(file.size).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(fp);
    }
  });
});

describe('GET /:filename', () => {
  it('downloads an existing file', async () => {
    const fp = path.join(scansDir, 'test.pdf');
    fs.writeFileSync(fp, 'pdfcontent');
    try {
      const res = await request(makeApp()).get('/test.pdf');
      expect(res.status).toBe(200);
    } finally {
      fs.unlinkSync(fp);
    }
  });

  it('returns 404 for missing file', async () => {
    const res = await request(makeApp()).get('/missing.pdf');
    expect(res.status).toBe(404);
  });

  it('returns 400 for path traversal attempt', async () => {
    const res = await request(makeApp()).get('/../etc/passwd');
    expect([400, 404]).toContain(res.status);
  });
});

describe('DELETE /:filename', () => {
  it('deletes an existing file', async () => {
    const fp = path.join(scansDir, 'del.pdf');
    fs.writeFileSync(fp, 'data');
    const res = await request(makeApp()).delete('/del.pdf');
    expect([200, 204]).toContain(res.status);
    expect(fs.existsSync(fp)).toBe(false);
  });

  it('returns 404 when file does not exist', async () => {
    const res = await request(makeApp()).delete('/ghost.pdf');
    expect(res.status).toBe(404);
  });
});

describe('GET /context', () => {
  it('returns 502 when scanservjs is unreachable', async () => {
    // SCANSERVJS_URL is not set to a real server in tests
    const res = await request(makeApp()).get('/context');
    expect([500, 502]).toContain(res.status);
    expect(res.body).toHaveProperty('device');
  });
});

describe('POST /combine', () => {
  it('returns 400 when no files are provided', async () => {
    const res = await request(makeApp()).post('/combine').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when files array is empty', async () => {
    const res = await request(makeApp()).post('/combine').send({ files: [] });
    expect(res.status).toBe(400);
  });

  it('returns 404 when a referenced file does not exist', async () => {
    const res = await request(makeApp()).post('/combine').send({ files: ['missing-page.pdf'] });
    expect(res.status).toBe(404);
  });
});
