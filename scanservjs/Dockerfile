FROM sbs20/scanservjs@sha256:e42263444a8dd5d533ead7d9eb2ef5fd9ca7a4a80569a6f9c14b7a3c21b9c7ca

LABEL description="Scanservjs web scanner UI with AirScan/eSCL support and rclone cloud upload"

ENV RCLONE_VERSION=v1.67.0

RUN set -eux; \
    ARCH="$(uname -m)"; \
    case "$ARCH" in \
        x86_64)  RCLONE_ARCH="amd64"   ;; \
        aarch64) RCLONE_ARCH="arm64"   ;; \
        armv7l)  RCLONE_ARCH="arm-v7"  ;; \
        *)       echo "Unsupported arch: $ARCH" >&2; exit 1 ;; \
    esac; \
    apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        unzip curl \
        sane-airscan \
        && \
    curl -fsSL \
        "https://github.com/rclone/rclone/releases/download/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-${RCLONE_ARCH}.zip" \
        -o /tmp/rclone.zip && \
    unzip -q /tmp/rclone.zip -d /tmp/rclone_extract && \
    mv "/tmp/rclone_extract/rclone-${RCLONE_VERSION}-linux-${RCLONE_ARCH}/rclone" \
       /usr/local/bin/rclone && \
    chmod 755 /usr/local/bin/rclone && \
    rm -rf /tmp/rclone.zip /tmp/rclone_extract && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY scripts/scan-save-upload.sh /usr/local/bin/scan-save-upload.sh

RUN chmod 755 /usr/local/bin/scan-save-upload.sh && \
    mkdir -p /app/data/output

# ── Add USB IDs of MFPs not yet in upstream sane-backends ─────────
# Samsung SCX-3400 Series (xerox_mfp backend) — VID:PID 04e8:344f.
# Without this entry scanimage -L returns "No scanners found" even
# though sane-find-scanner detects the device.
RUN grep -q '0x344f' /etc/sane.d/xerox_mfp.conf || \
    printf '\n# printershare: Samsung SCX-3400 Series\nusb 0x04e8 0x344f\n' \
    >> /etc/sane.d/xerox_mfp.conf
