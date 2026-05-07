// scanservjs runtime configuration
// Reference: https://github.com/sbs20/scanservjs

module.exports = {
  host: '0.0.0.0',
  port: 8080,

  // Directory where completed scans are written.
  // Mapped to ${SCANS_HOST_PATH} on the host via Docker volume.
  outputDirectory: '/app/data/output',

  defaultParams: {
    deviceId: '',
    resolution: 300,
    mode: 'Color',
    format: 'pdf',
    pageSize: 'A4',
  },

  // Post-scan pipeline: after each scan rclone uploads to cloud.
  // Remove the upload command entry to disable cloud upload.
  scanPipelines: [
    {
      description: 'Save as PDF (+ cloud upload)',
      commands: [
        'convert @- -compress jpeg -quality 92 $output.pdf',
        '/usr/local/bin/scan-save-upload.sh "$output.pdf"',
      ],
      output: 'pdf',
    },
    {
      description: 'Save as JPEG (+ cloud upload)',
      commands: [
        'convert @- -quality 92 $output.jpg',
        '/usr/local/bin/scan-save-upload.sh "$output.jpg"',
      ],
      output: 'jpg',
    },
    {
      description: 'Save as PNG (local only)',
      commands: [
        'convert @- $output.png',
      ],
      output: 'png',
    },
  ],

  devices: [],

  log: {
    level: 'info',
  },
};
