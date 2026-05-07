FROM sbs20/scanservjs:release

LABEL description="Scanservjs web scanner UI with rclone for Google Drive / OneDrive upload"

ENV RCLONE_VERSION=v1.67.0

RUN set -eux; \
    ARCH="$(uname -m)"; \
    case "$ARCH" in \
        x86_64)  RCLONE_ARCH="amd64"   ;; \
        aarch64) RCLONE_ARCH="arm64"   ;; \
        armv7l)  RCLONE_ARCH="arm-v7"  ;; \
        *)       echo "Unsupported arch: $ARCH" >&2; exit 1 ;; \
    esac; \
    apt-get update -qq && apt-get install -y --no-install-recommends unzip curl && \
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
