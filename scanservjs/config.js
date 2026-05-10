// scanservjs v3 user config (config.local.js)
// Reference: https://github.com/sbs20/scanservjs/blob/master/packages/server/config/config.default.js
//
// scanservjs only reads `afterConfig`, `afterDevices`, `afterScan`, and
// `actions` from the local config — top-level keys are ignored. Wrap
// everything we want to override inside afterConfig(config).
//
// The install.sh rewrites OUTPUT_DIRECTORY below to the host's scans
// directory (SCANS_DIR) before copying this file into place.

const OUTPUT_DIRECTORY = '/srv/printershare/scans';

module.exports = {
  /**
   * @param {object} config — scanservjs's runtime config object; mutate
   * in place to override defaults.
   */
  afterConfig(config) {
    config.host = '0.0.0.0';
    config.port = 8080;
    config.outputDirectory = OUTPUT_DIRECTORY;

    // The portal triggers scans via /api/v1/scans/run with explicit params,
    // but the scanservjs UI (proxied at /scan/) also uses these defaults.
    config.defaultParams = {
      ...config.defaultParams,
      deviceId: '',
      resolution: 300,
      mode: 'Color',
      pageSize: 'A4',
    };

    // Replace upstream's pipelines with PrinterShare-specific ones that
    // run our post-scan hook (rclone upload + chown to the scans user).
    config.pipelines = [
      {
        extension: 'pdf',
        description: 'PDF (+ cloud upload)',
        commands: [
          'convert @- -compress jpeg -quality 92 $output.pdf',
          '/usr/local/bin/scan-save-upload.sh "$output.pdf"',
        ],
      },
      {
        extension: 'jpg',
        description: 'JPG (+ cloud upload)',
        commands: [
          'convert @- -quality 92 $output.jpg',
          '/usr/local/bin/scan-save-upload.sh "$output.jpg"',
        ],
      },
      {
        extension: 'png',
        description: 'PNG (local only)',
        commands: ['convert @- $output.png'],
      },
    ];
  },
};
