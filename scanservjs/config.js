// scanservjs v3 user config (config.local.js)
// Reference: https://github.com/sbs20/scanservjs/blob/master/packages/server/config/config.default.js
//
// scanservjs only reads `afterConfig`, `afterDevices`, `afterScan`, and
// `actions` from the local config — top-level keys are ignored. Wrap
// everything we want to override inside afterConfig(config). Keep the
// upstream default pipelines (JPG/PNG/TIF/PDF in multiple qualities) so
// the portal and the scanservjs UI both work with their built-in option
// lists, and use afterScan() to run our post-scan hook on the final file.
//
// install.sh rewrites OUTPUT_DIRECTORY below to the host's scans
// directory (SCANS_DIR) before copying this file into place.

const { spawn } = require('node:child_process');

const OUTPUT_DIRECTORY = '/srv/printershare/scans';
const UPLOAD_HOOK      = '/usr/local/bin/scan-save-upload.sh';

module.exports = {
  /**
   * @param {object} config — scanservjs's runtime config object; mutate
   * in place to override defaults. Do NOT replace config.pipelines —
   * scanservjs validates the requested pipeline against this list and
   * rejects unknown names with HTTP 500.
   */
  afterConfig(config) {
    config.host = '0.0.0.0';
    config.port = 8080;
    config.outputDirectory = OUTPUT_DIRECTORY;
  },

  /**
   * Post-scan hook — invoked once per completed scan with the final
   * FileInfo. Used to mirror the file to cloud storage via rclone.
   * Non-blocking: scanservjs returns immediately to the caller.
   *
   * @param {{name:string, fullname:string, extension:string, size:number}} fileInfo
   */
  async afterScan(fileInfo) {
    try {
      const child = spawn(UPLOAD_HOOK, [fileInfo.fullname], {
        detached: true, stdio: 'ignore',
      });
      child.unref();
    } catch {
      /* upload hook is best-effort; never block the scan response */
    }
  },
};
