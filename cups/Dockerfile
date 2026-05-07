FROM ubuntu:22.04

LABEL description="CUPS print server with Bonjour/mDNS for USB printer LAN sharing"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    cups cups-bsd cups-filters cups-pdf \
    foomatic-db foomatic-db-compressed-ppds foomatic-db-engine \
    printer-driver-gutenprint hplip \
    avahi-daemon avahi-utils dbus libnss-mdns \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY cupsd.conf /etc/cups/cupsd.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 631

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:631/ || exit 1

CMD ["/entrypoint.sh"]
