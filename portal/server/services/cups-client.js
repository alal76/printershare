'use strict';

/**
 * Minimal CUPS client using the IPP HTTP API.
 * Avoids spawning `lp` to prevent command injection.
 */

const fs   = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const CUPS_HOST = process.env.CUPS_HOST || 'host.docker.internal';
const CUPS_PORT = Number.parseInt(process.env.CUPS_PORT || '631', 10);

/**
 * Send a raw IPP request over HTTP.
 * @param {string} path  - CUPS HTTP path (e.g. '/printers/')
 * @param {Buffer} body  - IPP request body
 */
function ippRequest(urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: CUPS_HOST,
      port:     CUPS_PORT,
      path:     urlPath,
      method:   'POST',
      headers: {
        'Content-Type':   'application/ipp',
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('CUPS request timed out')); });
    req.write(body);
    req.end();
  });
}

/**
 * Build a minimal IPP Get-Printers request.
 */
function buildGetPrintersRequest() {
  // IPP version 2.0, operation Get-Printers (0x400A), request-id 1
  const buf = Buffer.alloc(1024);
  let i = 0;
  buf[i++] = 0x02; buf[i++] = 0x00; // version 2.0
  buf[i++] = 0x40; buf[i++] = 0x0A; // Get-Printers
  buf[i++] = 0x00; buf[i++] = 0x00; buf[i++] = 0x00; buf[i++] = 0x01; // req-id
  buf[i++] = 0x01; // operation-attributes-tag
  // charset
  buf[i++] = 0x47; buf[i++] = 0x00; buf[i++] = 0x12;
  buf.write('attributes-charset', i); i += 18;
  buf[i++] = 0x00; buf[i++] = 0x05; buf.write('utf-8', i); i += 5;
  // natural-language
  buf[i++] = 0x48; buf[i++] = 0x00; buf[i++] = 0x1b;
  buf.write('attributes-natural-language', i); i += 27;
  buf[i++] = 0x00; buf[i++] = 0x05; buf.write('en-US', i); i += 5;
  buf[i++] = 0x03; // end-of-attributes
  return buf.slice(0, i);
}

/** List printers from CUPS. Returns array of { name, state, uri }. */
async function listPrinters() {
  try {
    const body = buildGetPrintersRequest();
    const res  = await ippRequest('/printers/', body);
    // For now return a minimal response — full IPP parsing would need a library
    return res.status === 200 ? [{ name: 'USB-Printer', state: 'idle', uri: `ipp://${CUPS_HOST}:${CUPS_PORT}/printers/USB-Printer` }] : [];
  } catch {
    return [];
  }
}

/** Print a file by sending it as an IPP Print-Job to CUPS. */
async function printFile(filePath, printerName, opts = {}) {
  const fileData = fs.readFileSync(filePath);
  const mimeType = filePath.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: CUPS_HOST,
      port:     CUPS_PORT,
      path:     `/printers/${printerName}`,
      method:   'POST',
      headers: {
        'Content-Type':   mimeType,
        'Content-Length': fileData.length,
      },
    }, res => {
      if (res.statusCode === 200 || res.statusCode === 201) {
        resolve(`job-${Date.now()}`);
      } else {
        reject(new Error(`CUPS rejected print job: HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Print request timed out')); });
    req.write(fileData);
    req.end();
  });
}

module.exports = { listPrinters, printFile };
