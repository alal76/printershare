# Beta test version v1.2.0
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ipp-usb \
      avahi-daemon \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# State directory mounted via volume in compose
RUN mkdir -p /var/ipp-usb

EXPOSE 60000

# Run in foreground; ipp-usb manages its own discovery loop
CMD ["/usr/sbin/ipp-usb"]
