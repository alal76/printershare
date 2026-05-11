// Beta test version v1.2.0
/**
 * Unit tests for server/routes/jobs.js + lib/device-lock telemetry.
 */
import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll } from 'vitest';

const req = createRequire(import.meta.url);
const request  = req('supertest');
const express  = req('express');

const jobsRouter = req('../../../server/routes/jobs');
const deviceLock = req('../../../server/lib/device-lock');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', jobsRouter);
  return app;
}

describe('GET /api/v1/jobs', () => {
  beforeAll(() => {
    // CUPS_LOCAL=1 + nonsense PATH ensures lpstat is "not found" → empty list,
    // not a hang or exception. The route swallows non-zero exits.
    process.env['CUPS_LOCAL'] = '1';
  });

  it('returns print + scan job snapshots', async () => {
    const app = makeApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('print');
    expect(res.body).toHaveProperty('scan');
    expect(res.body.print).toHaveProperty('jobs');
    expect(Array.isArray(res.body.print.jobs)).toBe(true);
    expect(res.body.scan).toMatchObject({
      active:    expect.any(Number),
      queued:    expect.any(Number),
      completed: expect.any(Number),
    });
  });

  it('reports scan activity from device-lock telemetry', async () => {
    const before = deviceLock.getJobStatus();
    expect(before.active).toBe(0);

    // Run a no-op through the lock — completion counter must increment.
    await deviceLock.withScanLock(async () => 'ok').catch(() => undefined);

    const after = deviceLock.getJobStatus();
    expect(after.completed).toBeGreaterThanOrEqual(before.completed + 1);
    expect(after.active).toBe(0);
  });
});
