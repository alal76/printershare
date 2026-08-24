// Beta test version v1.2.0
'use strict';

const { spawnSync } = require('node:child_process');
const { ensureAwakeForPrinterUri } = require('../lib/device-wake');

function run(command, args, timeout = 10_000) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited with ${result.status}`);
  }
  return result.stdout.trim();
}

function parsePrinterState(detail) {
  if (detail.startsWith('is idle')) return 'idle';
  if (detail.startsWith('is busy')) return 'busy';
  if (detail.startsWith('disabled')) return 'disabled';
  return 'unknown';
}

function getUrisByPrinter() {
  const out = run('lpstat', ['-v'], 5000);
  const lines = out.split('\n');
  const map = {};
  for (const line of lines) {
    const m = /^device for (\S+):\s*(\S+)$/.exec(line.trim());
    if (!m) continue;
    map[m[1]] = m[2];
  }
  return map;
}

/** List printers from CUPS. Returns array of { name, state, uri }. */
async function listPrinters() {
  try {
    const printerOut = run('lpstat', ['-p'], 5000);
    const uris = getUrisByPrinter();
    const printers = [];

    for (const line of printerOut.split('\n')) {
      const m = /^printer (\S+)\s+(.+)$/.exec(line.trim());
      if (!m) continue;
      const name = m[1];
      printers.push({
        name,
        state: parsePrinterState(m[2]),
        uri: uris[name] || '',
      });
    }
    return printers;
  } catch {
    return [];
  }
}

/** Print a file by calling lp with arg-array execution. */
async function printFile(filePath, printerName, opts = {}) {
  // Best-effort: wake the target before submitting so the job doesn't sit
  // stuck in CUPS waiting on a sleeping USB or network printer.
  await ensureAwakeForPrinterUri(getUrisByPrinter()[printerName]);

  const copies = Number.parseInt(String(opts.copies || '1'), 10);
  const args = ['-d', printerName, '-n', Number.isInteger(copies) && copies > 0 ? String(copies) : '1'];

  if (opts.color === 'mono') args.push('-o', 'ColorModel=Gray');
  if (opts.color === 'color') args.push('-o', 'ColorModel=RGB');

  args.push(filePath);

  const out = run('lp', args, 30_000);
  const m = /request id is \S+-(\d+)/i.exec(out);
  return m ? m[1] : `job-${Date.now()}`;
}

module.exports = { listPrinters, printFile };
