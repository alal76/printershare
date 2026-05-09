FROM ubuntu:22.04

LABEL description="CUPS print server with AirPrint/Mopria (IPP Everywhere) for USB printer LAN sharing"

ENV DEBIAN_FRONTEND=noninteractive

# Optional extra packages injected by the wizard (e.g. printer-driver-escpr)
ARG EXTRA_PACKAGES=""

RUN apt-get update && apt-get install -y --no-install-recommends \
    cups cups-bsd cups-filters cups-pdf cups-ipp-utils \
    foomatic-db-compressed-ppds foomatic-db-engine \
    printer-driver-gutenprint hplip \
    avahi-daemon avahi-utils dbus libnss-mdns \
    ca-certificates curl wget \
    && if [ -n "$EXTRA_PACKAGES" ]; then \
         apt-get install -y --no-install-recommends $EXTRA_PACKAGES; \
       fi \
    && rm -rf /var/lib/apt/lists/*

COPY cupsd.conf /etc/cups/cupsd.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 631

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:631/ || exit 1

CMD ["/entrypoint.sh"]
