// Beta test version v1.2.0
'use strict';

const router = require('express').Router();
const fs     = require('node:fs');
const path   = require('node:path');
const { spawn }  = require('node:child_process');
const mime   = require('mime-types');
const { withScanLock } = require('../lib/device-lock');
const { isNative } = require('../lib/deployment');
const { getDefaultScanner } = require('../lib/scanner-prefs');

const SCANS_PATH  = process.env.SCANS_PATH || '/scans';
const SCANSERVJS_URL = process.env.SCANSERVJS_URL || (isNative() ? 'http://127.0.0.1:8080' : 'http://ps-scanservjs:8080');

const MAX_PREVIEW = 100; // max files to list

/** Safe basename — strip any path traversal */
function safeName(name) {
  return path.basename(name).replaceAll(/[^a-zA-Z0-9._-]/g, '_');
}

// GET /api/v1/scans/context — return scanner device capabilities from scanservjs
router.get('/context', async (_req, res) => {
  try {
    const r = await fetch(`${SCANSERVJS_URL}/api/v1/context`);
    if (!r.ok) return res.status(502).json({ error: 'Scanner unavailable', device: null });
    const ctx = await r.json();
    const preferred = getDefaultScanner();
    const device = (preferred && ctx.devices?.find(d => d.id === preferred)) || ctx.devices?.[0] || null;
    res.json({
      device: device ? {
        id:       device.id,
        name:     device.name,
        features: device.features ?? {},
        settings: device.settings ?? {},
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message), device: null });
  }
});

// POST /api/v1/scans/combine — merge multiple single-page PDFs into one using pdfunite
router.post('/combine', (req, res) => {
  const { files, outputName, deleteAfter } = req.body ?? {};
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files specified' });
  }
  const safePaths = files.map(f => path.join(SCANS_PATH, safeName(f)));
  for (const p of safePaths) {
    if (!fs.existsSync(p)) return res.status(404).json({ error: `Not found: ${path.basename(p)}` });
  }
  const rawName = String(outputName || `scan-multipage-${Date.now()}`);
  const outName = safeName(rawName).replace(/\.[^.]*$/, '') + '.pdf';
  const outPath = path.join(SCANS_PATH, outName);

  const child = spawn('pdfunite', [...safePaths, outPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += String(d); });
  child.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: `Combine failed: ${stderr.slice(0, 300)}` });
    if (deleteAfter === true) {
      for (const p of safePaths) { try { fs.unlinkSync(p); } catch { /* best effort */ } }
    }
    res.json({ ok: true, name: outName });
  });
});

// GET /api/v1/scans — list files
router.get('/', (_req, res) => {
  try {
    if (!fs.existsSync(SCANS_PATH)) return res.json({ files: [] });
    const entries = fs.readdirSync(SCANS_PATH, { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => {
        const full = path.join(SCANS_PATH, e.name);
        const stat = fs.statSync(full);
        return {
          name:      e.name,
          size:      stat.size,
          date:      stat.mtime.toISOString(),
          mimeType:  mime.lookup(e.name) || 'application/octet-stream',
          url:       `/api/v1/scans/${encodeURIComponent(e.name)}`,
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, MAX_PREVIEW);
    res.json({ files: entries });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// GET /api/v1/scans/:filename — download a file
router.get('/:filename', (req, res) => {
  const name = safeName(req.params.filename);
  const full = path.join(SCANS_PATH, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  const mimeType = mime.lookup(name) || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  res.sendFile(full);
});

// DELETE /api/v1/scans/:filename
router.delete('/:filename', (req, res) => {
  const name = safeName(req.params.filename);
  const full = path.join(SCANS_PATH, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(full);
  res.status(204).end();
});

/**
 * Coerce a user-friendly param value (e.g. `mode: "Color"`) to one of the
 * options actually advertised by the device's SANE backend. Backends use
 * inconsistent labels — generic SANE returns "Color"/"Gray"/"Lineart",
 * while Samsung's smfp backend returns "Color - 16 Million Colors" /
 * "Grayscale - 256 Levels" / "Black and White - Line Art". The portal
 * frontend stays simple and the coercion handles the variants.
 *
 * Matches by lowercase prefix / substring against the option labels;
 * returns the original value if no option list is available (e.g. for
 * numeric/range features) or no match is found.
 *
 * @param {string} requested
 * @param {{options?: string[]}} feature
 */
function coerceOption(requested, feature) {
  if (!feature || !Array.isArray(feature.options) || feature.options.length === 0) return requested;
  if (feature.options.includes(requested)) return requested;
  const needle = String(requested).toLowerCase();
  const tokens = needle.split(/[\s-]+/).filter(Boolean);
  const match = feature.options.find(opt => {
    const lo = String(opt).toLowerCase();
    return tokens.every(t => lo.includes(t));
  })
    ?? feature.options.find(opt => String(opt).toLowerCase().startsWith(needle));
  return match ?? requested;
}

/**
 * Walk `params` and substitute each value with the device-specific
 * equivalent advertised in `device.features`. scanservjs's feature map
 * is keyed by SANE option name (`--mode`, `--source`, `--resolution`),
 * which we map from the request-param keys (`mode`, `source`, `resolution`).
 *
 * @param {Record<string, unknown>} params
 * @param {{features?: Record<string, {options?: string[]}>}} device
 */
function coerceParams(params, device) {
  if (!device?.features) return params;
  const map = { mode: '--mode', source: '--source', resolution: '--resolution' };
  const out = { ...params };
  for (const [k, saneKey] of Object.entries(map)) {
    if (out[k] != null && device.features[saneKey]) {
      out[k] = coerceOption(out[k], device.features[saneKey]);
    }
  }
  return out;
}

/**
 * POST /api/v1/scans/run
 * Body: scanservjs scan request payload
 *   { params: { deviceId?, mode, source, resolution, ... },
 *     pipeline?, filters?, batch?, index? }
 *
 * Acquires the device lock so CUPS releases the USB interface, forwards the
 * request to scanservjs, then returns the device to CUPS.  Concurrent scan
 * requests serialize behind the same lock; a print job in flight blocks the
 * scan until the print finishes (cupsdisable -h waits for active jobs).
 *
 * If `params.deviceId` is missing, the handler fetches /context (under the
 * lock, so SANE can see the device after CUPS released it) and uses the
 * first available device.  If `pipeline` is missing, the device's default
 * pipeline is used.
 */
router.post('/run', async (req, res) => {
  try {
    const result = await withScanLock(async () => {
      const userPayload = req.body ?? {};
      let payload = userPayload;

      // If the caller didn't pin a deviceId, discover it now (under the lock)
      // and coerce request params to values the chosen device actually supports.
      if (!userPayload?.params?.deviceId) {
        const ctxRes = await fetch(`${SCANSERVJS_URL}/api/v1/context`);
        if (!ctxRes.ok) {
          return { status: 503, body: { error: 'scanservjs context unavailable' } };
        }
        const ctx = await ctxRes.json();
        const device = ctx.devices?.[0];
        if (!device) {
          return { status: 404, body: { error: 'No scanner detected' } };
        }
        payload = {
          ...userPayload,
          params: { ...coerceParams(userPayload.params || {}, device), deviceId: device.id },
          pipeline: userPayload.pipeline || device.settings?.pipeline?.default,
          filters:  userPayload.filters  ?? [],
          batch:    userPayload.batch    ?? 'none',
          index:    userPayload.index    ?? 1,
        };
      }

      const upstream = await fetch(`${SCANSERVJS_URL}/api/v1/scan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const text = await upstream.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      return { status: upstream.status, body };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(0, 300) });
  }
});

module.exports = router;
