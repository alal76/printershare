# printershare — Full Feature Specifications

> **Status:** Design / pre-implementation  
> **Covers:** AirPrint · Mopria · eSCL/AirScan · Cloud printing · Mobile scanning · Wizard UI · USB auto-detection

---

## Table of Contents

1. [Current State — Gap Analysis](#1-current-state--gap-analysis)
2. [AirPrint & IPP Everywhere](#2-airprint--ipp-everywhere)
3. [Mopria Print (Android)](#3-mopria-print-android)
4. [eSCL / AirScan — Mobile & Driverless Scanning](#4-escl--airscan--mobile--driverless-scanning)
5. [Cloud Printing — Google Cloud Print Replacement](#5-cloud-printing--google-cloud-print-replacement)
6. [Paperless-ngx OCR & Document Management](#6-paperless-ngx-ocr--document-management)
7. [Mobile Scanning Landscape](#7-mobile-scanning-landscape)
8. [USB Auto-Detection — Hotplug & Port Persistence](#8-usb-auto-detection--hotplug--port-persistence)
9. [Wizard-Based Setup Interface](#9-wizard-based-setup-interface)
10. [Security Hardening](#10-security-hardening)
11. [Implementation Roadmap](#11-implementation-roadmap)

---

## 1. Current State — Gap Analysis

### What works today
| Capability | Status | Notes |
|---|---|---|
| USB printer sharing via CUPS | ✅ Working | IPP + LPD |
| Bonjour/mDNS discovery | ✅ Working | Avahi in CUPS container |
| Web scan UI | ✅ Working | scanservjs on port 80 |
| SMB share | ✅ Working | dperson/samba |
| NFS share | ✅ Working | erichough/nfs-server |
| rclone cloud upload | ✅ Working | Google Drive + OneDrive |
| AirPrint (iOS/macOS) | ⚠️ Partial | Bonjour advertises but no IPP Everywhere driver configured |
| Mopria (Android) | ⚠️ Partial | Same root cause as AirPrint |
| eSCL/AirScan | ❌ Missing | No AirScan endpoint; iOS/macOS can't scan wirelessly |
| Cloud/remote printing | ❌ Missing | No access outside LAN |
| USB hotplug recovery | ⚠️ Partial | Container restarts if device disappears; no udev rebind |
| USB port persistence | ❌ Missing | Bus ID changes across reboots/hubs break USB/IP bindings |
| Setup wizard | ❌ Missing | Manual .env editing required |
| OCR / document indexing | ❌ Missing | No text extraction from scans |
| Mobile-optimised scan UI | ⚠️ Partial | scanservjs is responsive but no native app flow |

### Root causes of AirPrint gap
CUPS advertises the printer over Bonjour (`_ipp._tcp`) but for iOS/macOS to print
without a driver the queue **must** be configured with the `everywhere` driver
(IPP Everywhere / PWG Raster). The current setup uses vendor PPDs which iOS
cannot consume.

---

## 2. AirPrint & IPP Everywhere

### 2.1 How AirPrint works
AirPrint is Apple's brand name for **IPP Everywhere** (PWG 5100.14) combined with
Bonjour service discovery. When iOS or macOS looks for printers it sends an
mDNS query for `_ipp._tcp.local` and `_ipps._tcp.local`. CUPS replies with a
DNS-SD TXT record that includes the printer's capabilities (resolution, colour,
duplex, media sizes). The client renders the job to PWG Raster or PDF and sends
it via IPP.

**No special Apple software is needed on the server** — CUPS ≥ 2.2 with
`everywhere` (driverless) driver and a working Avahi daemon is sufficient.

### 2.2 Required changes

#### cups/cupsd.conf additions
```
# AirPrint — IPP Everywhere requires these options
ServerAlias *                 # already present
BrowseLocalProtocols dnssd    # already present
DNSSDHostName <HOSTNAME>      # add: use hostname not IP for stable mDNS name

# Advertise on both plain and TLS sub-types for AirPrint
<Printer yourprinter>
  Browsing yes
</Printer>
```

#### cups/entrypoint.sh additions
After CUPS starts, add a post-start probe that re-registers each printer with
the `everywhere` driver if it was added with a PPD driver:

```bash
# Re-register printers with IPP Everywhere (AirPrint-compatible)
register_airprint() {
    local PRINTER="$1"
    local URI
    URI=$(lpstat -v "$PRINTER" 2>/dev/null | awk '{print $NF}')
    # Create a driverless clone with -airprint suffix if not already present
    if ! lpstat -p "${PRINTER}-airprint" &>/dev/null; then
        lpadmin -p "${PRINTER}-airprint" \
                -E \
                -v "$URI" \
                -m everywhere \
                -o printer-is-shared=true
        echo "[airprint] Registered ${PRINTER}-airprint"
    fi
}
# Run after 10 s to allow USB enumeration
(sleep 10; for P in $(lpstat -p 2>/dev/null | awk '{print $2}'); do
    register_airprint "$P"
done) &
```

#### docker-compose.yml addition
The CUPS container already runs with `network_mode: host` and Avahi. Add:
```yaml
cups:
  environment:
    CUPS_AIRPRINT: "true"          # triggers entrypoint auto-registration
  volumes:
    - /run/avahi-daemon/socket:/run/avahi-daemon/socket  # share host Avahi socket
```

**Preferred alternative:** Run `ipp-usb` (see §8) alongside CUPS.
`ipp-usb` wraps the USB printer in a full IPP-over-USB HTTP proxy and
automatically advertises it over Bonjour with correct AirPrint TXT records,
making the printer natively AirPrint-capable without PPD workarounds.

### 2.3 ipp-usb Docker service (recommended path)

`ipp-usb` (OpenPrinting) is the canonical solution for AirPrint from a USB
printer. It acts as a transparent HTTP reverse proxy over the USB IPP interface
and publishes the correct `_ipp._tcp` and `_ippfax._tcp` Bonjour records,
including the `URF` TXT key that identifies AirPrint to Apple clients.

```yaml
# docker-compose.yml — add this service
ipp-usb:
  image: ghcr.io/openprinting/ipp-usb:latest
  container_name: ps-ipp-usb
  restart: unless-stopped
  network_mode: host
  privileged: true
  volumes:
    - /dev/bus/usb:/dev/bus/usb
    - /var/run/avahi-daemon:/var/run/avahi-daemon
    - /run/dbus:/run/dbus
    - ipp-usb-state:/var/ipp-usb
    - ipp-usb-conf:/etc/ipp-usb
  device_cgroup_rules:
    - "c 189:* rmw"
  environment:
    IPP_USB_INTERFACE: all        # expose to LAN, not just loopback
```

**How it interacts with CUPS:**  
- `ipp-usb` creates a virtual network IPP endpoint (e.g. `ipp://localhost:60000`)
- CUPS adds the printer using `lpadmin -p Printer -E -v ipp://localhost:60000/ipp/print -m everywhere`
- Avahi publishes `_ipp._tcp` and `_ipps._tcp` with proper URF/PDF-ver TXT records
- iOS/macOS/Android see the printer as AirPrint/Mopria certified

### 2.4 Acceptance criteria
- iPhone (iOS 13+) can add printer with zero configuration from Settings → AirPrint
- macOS 12+ System Settings → Printers finds printer without manual IP entry
- A 1-page colour PDF prints correctly from Safari on iPhone
- `dns-sd -B _ipp._tcp` on macOS lists the printer

---

## 3. Mopria Print (Android)

### 3.1 How Mopria works
Mopria Print Service is built into Android 8.0+ (Google Play Services) and is
enabled by default on Android 10+. It uses the **same IPP Everywhere standard**
as AirPrint, discovered via mDNS (`_ipp._tcp`). No extra server configuration
is needed beyond what §2 specifies — a correctly advertised IPP Everywhere queue
in CUPS serves both AirPrint (Apple) and Mopria (Android) clients.

### 3.2 Required changes
No additional server changes beyond §2. The `ipp-usb` path automatically
provides Mopria compatibility.

Verify with Android:  
Settings → Connected devices → Connection preferences → Printing →
Mopria Print Service → should list the printer.

### 3.3 Acceptance criteria
- Android 10+ phone discovers printer without any manual configuration
- A test page prints from Chrome on Android
- Mopria Print Service shows printer as "Available"

---

## 4. eSCL / AirScan — Mobile & Driverless Scanning

### 4.1 What is eSCL / AirScan
**eSCL** (embedded Scanner Control Language) is Apple's REST-based wireless
scanning protocol (also called **AirScan**). It is standardised by Mopria as
the **Mopria Scan** protocol and implemented in Linux by
[**sane-airscan**](https://github.com/alexpevzner/sane-airscan).

`ipp-usb` (§2.3) already supports eSCL over USB: if the connected
scanner supports eSCL (most modern Canon/HP/Epson MFPs do), `ipp-usb` exposes
it on the same local port and advertises `_uscan._tcp` over Bonjour, making it
immediately discoverable by:
- macOS Image Capture / Preview / Continuity Camera
- iOS 13+ (Scan to iPhone via AirDrop / Files app)
- Windows 10/11 (built-in WSD scanning via Mopria)
- Any SANE client via `sane-airscan` backend

### 4.2 Required changes

#### 4.2.1 Add sane-airscan to scanservjs container
```dockerfile
# scanservjs/Dockerfile — add
RUN apt-get update && apt-get install -y --no-install-recommends \
    sane-airscan \
    && rm -rf /var/lib/apt/lists/*
```

`sane-airscan` discovers eSCL scanners via mDNS and adds them as SANE
devices automatically. No configuration file is required for auto-discovered
devices.

#### 4.2.2 SANE network scanner advertisement
For the scanner to be discoverable by macOS/iOS without `ipp-usb` (fallback),
add `saned` exposure:
```
# /etc/sane.d/saned.conf (in scanservjs container)
0.0.0.0/0          # restrict to LAN subnet in production e.g. 192.168.1.0/24
```

Advertise `_sane-port._tcp` via Avahi:
```xml
<!-- /etc/avahi/services/saned.service -->
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Scanner on %h</name>
  <service>
    <type>_sane-port._tcp</type>
    <port>6566</port>
  </service>
</service-group>
```

#### 4.2.3 eSCL proxy via nginx (for external access)
If remote scanning is required, add an nginx location:
```nginx
location /eSCL/ {
    proxy_pass http://host.docker.internal:60000/eSCL/;
    # 60000 = ipp-usb local port
}
```

### 4.3 Acceptance criteria
- macOS Preview → File → Import from Scanner finds the device
- iOS 16+ Files app can scan directly to a PDF
- `scanimage -L` inside scanservjs container lists device via airscan backend
- Scan from macOS produces correct colour/greyscale output

---

## 5. Cloud Printing — Google Cloud Print Replacement

> **Note:** Google Cloud Print was permanently shut down on December 31, 2020.
> Modern cloud printing is achieved via self-hosted VPN tunnels or HTTPS
> proxies, not a Google-operated relay.

### 5.1 Options comparison

| Approach | Complexity | Cost | Privacy | Print from mobile WAN |
|---|---|---|---|---|
| **Tailscale + CUPS** | Low | Free (personal) | High | ✅ |
| **Cloudflare Tunnel** | Low | Free | Medium | ✅ |
| **WireGuard VPN** | Medium | Free | High | ✅ |
| **CUPS HTTPS + Let's Encrypt** | Medium | Free | High | ✅ |
| **Printix / ezeep** | Low | Paid SaaS | Low | ✅ |
| **IPPS (TLS) direct** | Medium | Free | High | ✅ |

### 5.2 Recommended: Tailscale print node

Tailscale creates a WireGuard mesh VPN. Once the server and client devices join
the same Tailnet, the server's CUPS becomes reachable from anywhere as if on
the local network.

#### docker-compose.yml addition
```yaml
tailscale:
  image: tailscale/tailscale:latest
  container_name: ps-tailscale
  restart: unless-stopped
  network_mode: host
  cap_add:
    - NET_ADMIN
    - NET_RAW
  volumes:
    - tailscale-state:/var/lib/tailscale
    - /dev/net/tun:/dev/net/tun
  environment:
    TS_AUTHKEY:        ${TAILSCALE_AUTH_KEY:-}      # one-time key from tailscale.com
    TS_EXTRA_ARGS:     "--advertise-tags=tag:printserver"
    TS_STATE_DIR:      /var/lib/tailscale
    TS_USERSPACE:      "false"
```

#### .env.example addition
```
# ── Cloud Printing (Tailscale) ──────────────────────────────────
# Generate at https://login.tailscale.com/admin/settings/keys
TAILSCALE_AUTH_KEY=
```

#### How clients print over Tailscale
1. Install Tailscale on phone/laptop
2. Sign in to same Tailnet
3. Add printer using Tailscale IP: `ipp://<tailscale-ip>:631/printers/<name>`
4. On iOS/macOS: AirPrint works over Tailscale automatically (mDNS-over-Tailscale via MagicDNS)

### 5.3 Alternative: Cloudflare Tunnel (HTTPS, no VPN client needed)

For sharing with users who cannot install Tailscale:
```yaml
cloudflared:
  image: cloudflare/cloudflared:latest
  container_name: ps-cloudflared
  restart: unless-stopped
  command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
  environment:
    TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:-}
```

Map `https://scan.yourdomain.com` → `http://ps-scanservjs:8080` in the
Cloudflare Zero Trust dashboard. This gives remote access to the scan UI over
HTTPS with optional authentication.

> **Security note:** Do not expose the CUPS admin interface (port 631) or Samba
> port (445) via Cloudflare Tunnel. Use only scanservjs for browser-based
> access; printing over WAN requires a VPN (Tailscale/WireGuard).

### 5.4 IPPS (IPP over TLS) for direct remote printing

For printing without a VPN, CUPS can be configured to serve IPPS with a
Let's Encrypt certificate via a reverse proxy:

```nginx
# nginx/nginx.conf — add HTTPS server block
server {
    listen 443 ssl;
    server_name print.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/print.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/print.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://host.docker.internal:631;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

Clients then use `ipps://print.yourdomain.com/printers/<name>` — natively
supported by iOS, macOS, and Windows 10/11 IPP class driver.

### 5.5 Acceptance criteria
- Printing from an LTE-connected iPhone works via Tailscale
- scanservjs web UI accessible from outside LAN via Cloudflare Tunnel HTTPS
- No credentials or keys are stored in git (`.gitignore` covers `.env`)
- TLS version ≥ 1.2, no self-signed certificates in production path

---

## 6. Paperless-ngx OCR & Document Management

### 6.1 What it adds
[Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) is a
self-hosted document management system with:
- Automatic OCR via Tesseract (40+ languages)
- Full-text search across all scanned documents
- Auto-tagging and correspondent detection via ML
- Web UI for browsing, annotating, and downloading documents
- Consumption folder: drop a file → auto-ingested + indexed

### 6.2 Integration architecture

```
scanservjs scan → /srv/printershare/scans/  ← shared volume
                                             ↓
                            Paperless-ngx consumption folder
                                             ↓
                            OCR + index + move to archive
                                             ↓
                            http://<HOST>:8000/documents/
```

### 6.3 docker-compose.yml additions

```yaml
paperless-redis:
  image: redis:7-alpine
  container_name: ps-paperless-redis
  restart: unless-stopped
  volumes:
    - paperless-redis:/data

paperless-db:
  image: postgres:16-alpine
  container_name: ps-paperless-db
  restart: unless-stopped
  volumes:
    - paperless-db:/var/lib/postgresql/data
  environment:
    POSTGRES_DB:       paperless
    POSTGRES_USER:     paperless
    POSTGRES_PASSWORD: ${PAPERLESS_DB_PASS:-paperless123}

paperless:
  image: ghcr.io/paperless-ngx/paperless-ngx:latest
  container_name: ps-paperless
  restart: unless-stopped
  depends_on:
    - paperless-db
    - paperless-redis
  ports:
    - "${PAPERLESS_PORT:-8000}:8000"
  volumes:
    - paperless-data:/usr/src/paperless/data
    - paperless-media:/usr/src/paperless/media
    - paperless-export:/usr/src/paperless/export
    # Consumption folder = same dir scanservjs writes to
    - ${SCANS_HOST_PATH:-/srv/printershare/scans}:/usr/src/paperless/consume
  environment:
    PAPERLESS_REDIS:          redis://ps-paperless-redis:6379
    PAPERLESS_DBHOST:         ps-paperless-db
    PAPERLESS_DBNAME:         paperless
    PAPERLESS_DBUSER:         paperless
    PAPERLESS_DBPASS:         ${PAPERLESS_DB_PASS:-paperless123}
    PAPERLESS_SECRET_KEY:     ${PAPERLESS_SECRET_KEY:-changeme-32chars-minimum}
    PAPERLESS_OCR_LANGUAGE:   ${PAPERLESS_OCR_LANG:-eng}
    PAPERLESS_TIME_ZONE:      ${TZ:-Europe/London}
    PAPERLESS_ADMIN_USER:     ${PAPERLESS_ADMIN_USER:-admin}
    PAPERLESS_ADMIN_PASSWORD: ${PAPERLESS_ADMIN_PASS:-changeme}
    # Don't delete originals from consume dir (scanservjs keeps them too)
    PAPERLESS_CONSUMER_DELETE_DUPLICATES: "false"
```

### 6.4 nginx routing addition
```nginx
location /docs/ {
    proxy_pass       http://ps-paperless:8000/;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 6.5 Acceptance criteria
- A scan from scanservjs appears in Paperless-ngx within 60 seconds
- OCR text is searchable from Paperless-ngx web UI
- `/docs/` accessible from LAN browsers
- Original files remain in `/srv/printershare/scans/` for Samba/NFS access

---

## 7. Mobile Scanning Landscape

### 7.1 Summary of comparable solutions

| Solution | Type | Protocol | Strengths | Weaknesses |
|---|---|---|---|---|
| **scanservjs** (current) | Self-hosted web app | SANE | No client install, Docker, pipelines | No AirScan, no push notification |
| **sane-airscan** | SANE backend | eSCL / WSD | Native OS integration, no app needed | Server-side only, needs Avahi |
| **ipp-usb** | USB-to-IPP proxy | eSCL / IPP | Best AirPrint/AirScan combo | Linux-only server, Go daemon |
| **Paperless-ngx** | DMS with consumption | Filesystem | OCR, full-text search, tagging | Heavyweight (Postgres, Redis) |
| **DocuSeal** | Document signing + scan | Web | E-signatures, templates | Overkill for basic scanning |
| **Nextcloud + Scan** | Cloud storage + scan app | WebDAV | Full cloud suite | Very heavyweight |
| **FaxServer / HylaFAX** | Fax over IP | T.38 | Sends scans as fax | Niche use case |
| **OpenDocMan** | Document management | Web | Simple DMS | No scan integration |

### 7.2 Recommended stack additions

**For consumer/home use (LAN only):**
- Add `ipp-usb` → enables AirPrint + AirScan natively (§2.3, §4)
- Add `sane-airscan` in scanservjs container → picks up networked scanners (§4.2)
- Optionally add Paperless-ngx for OCR search (§6)

**For remote/cloud access:**
- Add Tailscale service (§5.2) → zero-config remote printing from mobile
- Add Cloudflare Tunnel (§5.3) → remote scan UI without VPN

**For enterprise / multi-user:**
- Replace scanservjs with Paperless-ngx (consumption + web upload)
- Add LDAP/SAML authentication to nginx via `nginx-ldap-auth`
- Add audit logging via nginx `access_log` to ELK/Loki

### 7.3 iOS/macOS native scanning flows (post-implementation)
| Flow | What user does | Infrastructure needed |
|---|---|---|
| AirPrint from any app | Tap Share → Print → select printer | ipp-usb + CUPS everywhere |
| AirScan from macOS Preview | File → Import from Scanner | ipp-usb (eSCL) |
| AirScan from iOS Files | Scan Document in Files | ipp-usb (eSCL) |
| Continuity Camera | Insert from iPhone/iPad in macOS app | ipp-usb (eSCL) |
| Browser scan UI | Open `http://<host>/` | scanservjs (current) |
| Remote scan via HTTPS | Open `https://scan.domain.com/` | Cloudflare Tunnel |

---

## 8. USB Auto-Detection — Hotplug & Port Persistence

### 8.1 Problems with current approach

1. **Static bind at daemon start:** `install-usbip-server.sh` runs
   `usbip bind -b <busid>` at systemd start. If the printer is unplugged and
   replugged, it gets a new bus ID (e.g. `1-1.2` → `1-1.3`) and the old bind
   entry is stale. The service must be restarted manually.

2. **Bus ID is not stable:** Linux assigns bus IDs based on physical USB port
   topology. Plugging into a different port changes the bus ID. USB/IP clients
   lose their connection.

3. **CUPS device URI can break:** If CUPS stored the printer as `usb://HP/...`
   by device path index, a different enumeration order (e.g. after hub power
   cycle) can produce a different URI.

4. **Docker container `/dev/bus/usb` passthrough:** The entire bus is passed in,
   not a specific device. This is fine for CUPS (which re-opens by VID:PID) but
   USB/IP binds by bus ID which can change.

### 8.2 udev-based auto-bind (host-level fix)

Install a udev rule on the host that automatically runs `usbip bind` whenever a
printer/scanner is plugged in, identified by **VID:PID** (stable, device-specific)
not bus ID.

#### New file: `usbip/udev/99-usbip-autorebind.rules`
```udev
# Auto-bind USB printers and scanners for USB/IP sharing
# Triggers on any USB device with class 7 (printer) or 14 (scanner/imaging)
ACTION=="add", SUBSYSTEM=="usb", \
  ATTR{bDeviceClass}=="07", \
  RUN+="/usr/local/sbin/usbip-bind-by-udev.sh %k"

ACTION=="add", SUBSYSTEM=="usb", \
  ATTR{bDeviceClass}=="0e", \
  RUN+="/usr/local/sbin/usbip-bind-by-udev.sh %k"

# Also catch multi-function devices (class 00, handled per-interface)
ACTION=="add", SUBSYSTEM=="usb", \
  ENV{DEVTYPE}=="usb_device", \
  ATTR{idVendor}!="", \
  RUN+="/usr/local/sbin/usbip-bind-by-udev.sh %k"
```

#### New file: `usbip/udev/usbip-bind-by-udev.sh`
```bash
#!/bin/bash
# Called by udev on USB device attach. Binds device for USB/IP sharing.
# $1 = kernel device name e.g. "1-1.2"
set -euo pipefail
BUSID="${1:-}"
[[ -z "$BUSID" ]] && exit 0

# Only bind if usbipd is running
systemctl is-active --quiet usbipd.service || exit 0

# Wait for device to settle
sleep 0.5

# Check it is a printer or scanner
CLASS=$(cat "/sys/bus/usb/devices/${BUSID}/bDeviceClass" 2>/dev/null || echo "00")
IFACE_CLASSES=$(ls "/sys/bus/usb/devices/${BUSID}/"*/bInterfaceClass 2>/dev/null \
    | xargs cat 2>/dev/null | sort -u || echo "")

is_print_or_scan() {
    echo "$IFACE_CLASSES" | grep -qE "^(07|0e)$"
}

[[ "$CLASS" == "07" || "$CLASS" == "0e" ]] || is_print_or_scan || exit 0

# Unbind from usblp kernel driver first (required for usbip)
BUSID_COMPAT="${BUSID//./-}"
for IFACE_PATH in "/sys/bus/usb/devices/${BUSID}/"*:*/; do
    DRIVER=$(readlink "${IFACE_PATH}driver" 2>/dev/null | xargs basename 2>/dev/null || echo "")
    if [[ "$DRIVER" == "usblp" || "$DRIVER" == "usb-storage" ]]; then
        IFACE=$(basename "$IFACE_PATH")
        echo "$IFACE" > /sys/bus/usb/drivers/"$DRIVER"/unbind 2>/dev/null || true
    fi
done

# Bind
usbip bind -b "$BUSID" 2>&1 | logger -t usbip-autobind || true
echo "[usbip-autobind] Bound $BUSID" | logger -t usbip-autobind
```

#### install-usbip-server.sh changes
Add udev rule installation after the systemd service block:

```bash
# ── 4. Install udev auto-rebind rules ────────────────────────────────────────
echo "==> Installing udev auto-rebind rules..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

install -o root -g root -m 644 \
    "${SCRIPT_DIR}/../usbip/udev/99-usbip-autorebind.rules" \
    /etc/udev/rules.d/99-usbip-autorebind.rules

install -o root -g root -m 755 \
    "${SCRIPT_DIR}/../usbip/udev/usbip-bind-by-udev.sh" \
    /usr/local/sbin/usbip-bind-by-udev.sh

udevadm control --reload-rules
udevadm trigger --subsystem-match=usb --action=add
echo "==> udev auto-rebind rules installed."
```

### 8.3 USB/IP port persistence by VID:PID

`ipp-usb` already solves this natively — it persists TCP port allocation by
`(VendorID, ProductID, SerialNumber)` in `/var/ipp-usb/dev/`. The device
always gets the same port regardless of physical USB port.

For vanilla USB/IP (`usbipd`) a wrapper is needed:

#### New file: `usbip/usbip-stable-bind.sh`
```bash
#!/bin/bash
# Bind a USB device by VID:PID (stable) rather than by bus ID (volatile).
# Usage: usbip-stable-bind.sh <VID> <PID>
# Example: usbip-stable-bind.sh 03f0 2b17   # HP LaserJet
set -euo pipefail
VID="${1:?Need VID e.g. 03f0}"
PID="${2:?Need PID e.g. 2b17}"

BUSID=$(usbip list -l 2>/dev/null \
    | grep -i "${VID}:${PID}" \
    | grep -oP 'busid \K[\d\-\.]+' \
    | head -1)

if [[ -z "$BUSID" ]]; then
    echo "Device ${VID}:${PID} not found" >&2
    exit 1
fi

usbip bind -b "$BUSID"
echo "Bound ${VID}:${PID} at busid ${BUSID}"
```

### 8.4 CUPS device re-discovery on hotplug

CUPS uses `/dev/usb/lp*` devices. On hotplug the kernel re-creates the
device node. CUPS detects this automatically via its device backend polling.
However, if the printer was configured with a `usb://` URI that includes a
serial number, and the printer does not expose a serial number, CUPS may fail
to match. Fix:

In `cups/entrypoint.sh`, add:
```bash
# Enable CUPS USB backend polling for hotplug recovery
cupsctl --debug-logging 2>/dev/null || true
# Tell CUPS to re-enumerate USB devices every 30 s
echo "DeviceURI usb://" | cupsaddsmb 2>/dev/null || true
# Restart CUPS backend after USB event
udevadm monitor --subsystem-match=usb --property 2>/dev/null | \
while read -r line; do
    if echo "$line" | grep -q "ACTION=add"; then
        sleep 2
        /usr/sbin/cupsd -t 2>/dev/null || true
        # Signal CUPS to re-scan devices
        kill -HUP "$(cat /run/cups/cupsd.pid 2>/dev/null)" 2>/dev/null || true
    fi
done &
```

For Docker: pass udev socket:
```yaml
cups:
  volumes:
    - /run/udev:/run/udev:ro
```

### 8.5 Acceptance criteria
- Unplug printer → plug back in → CUPS resumes printing within 30 seconds
- Plug printer into different USB port → USB/IP binding re-established automatically
- `usbip list -r <HOST>` shows device after hotplug without service restart
- No manual intervention required after power cycle

---

## 9. Wizard-Based Setup Interface

### 9.1 Goals

Replace the current manual `.env` editing flow with an interactive wizard that:
- Detects USB devices automatically
- Configures passwords securely
- Tests each service and reports status
- Requires no knowledge of Docker or Linux internals

### 9.2 Architecture options

| Option | Technology | Complexity | UX |
|---|---|---|---|
| **A. Enhanced Makefile wizard** | Bash + `dialog` / `whiptail` | Low | Terminal TUI |
| **B. Node.js web wizard** | Express + Vue | High | Browser UI |
| **C. Python Textual TUI** | Python `textual` | Medium | Terminal UI |
| **D. bash + gum** | [Charmbracelet gum](https://github.com/charmbracelet/gum) | Low | Beautiful terminal |

**Recommendation: Option A (Makefile + whiptail)** for zero extra dependencies
as a first step, with **Option D** as an upgrade for a polished experience.

### 9.3 Wizard flow specification

#### Step 0 — Prerequisites check
```
[✓] Docker 24.0+ installed
[✓] Docker Compose v2 installed
[✓] Running as user with docker group access
[?] USB devices detected (auto-scan)
```

#### Step 1 — USB device selection
```
Detected USB devices:
  ┌─────────────────────────────────────────────────────┐
  │  1. HP LaserJet Pro M404n     (VID:03f0 PID:2b17)  │
  │  2. Epson Perfection V39      (VID:04b8 PID:013c)  │
  └─────────────────────────────────────────────────────┘
Select printer [1]: _
Select scanner [2]: _
(Press Enter to use same device for both if MFP)
```

Implementation: `lsusb` + filter by class/known VID list.

#### Step 2 — Network configuration
```
Server IP detected: 192.168.1.50
Use detected IP? [Y/n]: _

Hostnames for Bonjour (for AirPrint):
  Printer name: [PrinterShare]: _
  Scanner name: [ScanShare]: _
```

#### Step 3 — Passwords
```
Set CUPS admin password:
  Username: admin
  Password: ________  (min 12 chars)
  Confirm:  ________

Set Samba share password:
  Username: scanner
  Password: ________
  Confirm:  ________

Set Paperless-ngx admin password (optional, press Enter to skip):
  Password: ________
```

Passwords written to `.env` with `chmod 600`.

#### Step 4 — Cloud upload (optional)
```
Configure cloud upload? [y/N]: _

  [1] Google Drive
  [2] Microsoft OneDrive
  [3] Both
  [4] Skip

Choice [4]: _
```
Spawns `rclone config` with pre-filled remote names.

#### Step 5 — Remote access (optional)
```
Enable remote access (print/scan from outside your network)?

  [1] Tailscale (recommended — free, zero-config VPN)
  [2] Cloudflare Tunnel (free, HTTPS — scan UI only)
  [3] Manual port forwarding (advanced)
  [4] Skip

Choice [4]: _
```
If Tailscale: prompts for auth key, writes `TAILSCALE_AUTH_KEY` to `.env`.
If Cloudflare: prompts for tunnel token.

#### Step 6 — Confirmation & build
```
Summary:
  Printer:        HP LaserJet Pro M404n (1-1.2)
  Scanner:        Epson Perfection V39 (1-1.3)
  CUPS admin:     admin  [password set]
  Samba user:     scanner  [password set]
  Cloud upload:   Google Drive (gdrive:)
  Remote access:  Tailscale

Proceed? [Y/n]: _

==> Creating scan directory /srv/printershare/scans ...
==> Writing .env ...
==> Pulling Docker images ...
==> Building custom images ...
==> Starting services ...

  [✓] CUPS        http://192.168.1.50:631/
  [✓] Scanner UI  http://192.168.1.50/
  [✓] Samba       \\192.168.1.50\Scans
  [✓] NFS         192.168.1.50:/exports/scans
  [✓] AirPrint    Available (printer registered with everywhere driver)
  [✓] Tailscale   Connected (100.64.x.x)
```

#### Step 7 — Post-install test
```
Run a test print? [Y/n]: _
  ==> Sending test page to HP LaserJet Pro M404n ...
  [✓] Test page printed successfully.

Run a test scan? [Y/n]: _
  ==> Starting scan ...
  [✓] Scan saved: /srv/printershare/scans/test-2026-05-07.pdf
```

### 9.4 Implementation: `scripts/wizard.sh`

```bash
#!/bin/bash
# printershare setup wizard
# Requires: dialog or whiptail, docker, lsusb
set -euo pipefail

UI="whiptail"
command -v whiptail &>/dev/null || UI="dialog"
command -v "$UI" &>/dev/null || apt-get install -y whiptail

TITLE="printershare Setup Wizard"
HEIGHT=20
WIDTH=70

step_prereqs() { ... }
step_usb_detect() { ... }
step_passwords() { ... }
step_cloud() { ... }
step_remote() { ... }
step_confirm_build() { ... }
step_test() { ... }

step_prereqs
step_usb_detect
step_passwords
step_cloud
step_remote
step_confirm_build
step_test
```

Full implementation to be built into `scripts/wizard.sh` with `make wizard`
target in Makefile.

### 9.5 Makefile addition
```makefile
wizard: ## Run interactive setup wizard
	@command -v whiptail >/dev/null 2>&1 || sudo apt-get install -y whiptail
	bash scripts/wizard.sh
```

### 9.6 Acceptance criteria
- `make wizard` runs end-to-end on a fresh Ubuntu 22.04 installation
- Wizard produces a correct `.env` that `make start` consumes without errors
- No manual file editing required for a standard home/office setup
- Wizard is idempotent: re-running updates `.env` without breaking a running stack

---

## 10. Security Hardening

### 10.1 Issues in current codebase

| Issue | Location | Severity |
|---|---|---|
| Default password `changeme` in `.env.example` | `.env.example` | High |
| Default Samba password `scanner123` in client scripts | `clients/client-*.sh` | High |
| CUPS admin accessible from all IPs with no rate-limit on direct :631 | `cupsd.conf` | Medium |
| NFS exports allow `*` (all hosts) | `nfs/exports` | High |
| No HTTPS on any service | `nginx/nginx.conf` | Medium |
| Passwords passed as plain-text in `samba` command args | `docker-compose.yml` | Medium |
| `privileged: true` on cups and scanservjs | `docker-compose.yml` | Medium |

### 10.2 Fixes

#### NFS exports — restrict to LAN
```
# nfs/exports — replace wildcard with subnet
/exports/scans ${NFS_ALLOWED_SUBNET:-192.168.0.0/16}(rw,sync,no_subtree_check,no_root_squash,insecure)
```

#### Drop `privileged: true` where possible
CUPS and scanservjs only need access to `/dev/bus/usb`. Replace `privileged: true`
with targeted capabilities:
```yaml
cups:
  privileged: false
  cap_add:
    - SYS_ADMIN    # for usblp rebind
  security_opt:
    - apparmor:unconfined
  device_cgroup_rules:
    - "c 189:* rmw"    # USB devices (major 189)
```

#### Samba password via secret file instead of command arg
```yaml
samba:
  secrets:
    - samba_pass
secrets:
  samba_pass:
    file: ./secrets/samba_pass.txt
```

#### Wizard enforces strong passwords
The wizard rejects passwords shorter than 12 characters and checks for
dictionary words via a simple pattern check.

---

## 11. Implementation Roadmap

### Phase 1 — AirPrint / Mopria / AirScan (≈ 1 week)
- [ ] Add `ipp-usb` Docker service to `docker-compose.yml`
- [ ] Add `sane-airscan` to `scanservjs/Dockerfile`
- [ ] Write Avahi `.service` XML for saned advertisement
- [ ] Update `cups/entrypoint.sh` with `everywhere` driver registration
- [ ] Test: AirPrint from iPhone, Mopria from Android, AirScan from macOS
- [ ] Update README with AirPrint/AirScan section

### Phase 2 — USB Hotplug & Persistence (≈ 3 days)
- [ ] Create `usbip/udev/99-usbip-autorebind.rules`
- [ ] Create `usbip/udev/usbip-bind-by-udev.sh`
- [ ] Update `scripts/install-usbip-server.sh` to install udev rules
- [ ] Create `usbip/usbip-stable-bind.sh` for VID:PID binding
- [ ] Update `cups/entrypoint.sh` with udev-triggered CUPS HUP
- [ ] Test: unplug/replug, different USB port, power cycle

### Phase 3 — Cloud Printing (≈ 3 days)
- [ ] Add `tailscale` service to `docker-compose.yml`
- [ ] Add `cloudflared` service to `docker-compose.yml`
- [ ] Add nginx HTTPS server block with Let's Encrypt support
- [ ] Update `.env.example` with Tailscale + Cloudflare vars
- [ ] Test: print from LTE-connected phone via Tailscale

### Phase 4 — Paperless-ngx Integration (≈ 2 days)
- [ ] Add paperless-ngx + Redis + Postgres to `docker-compose.yml`
- [ ] Add `/docs/` nginx proxy location
- [ ] Add Paperless vars to `.env.example`
- [ ] Test: scan → auto-OCR → searchable in Paperless-ngx

### Phase 5 — Setup Wizard (≈ 1 week)
- [ ] Implement `scripts/wizard.sh` (whiptail/dialog TUI)
- [ ] Add `make wizard` target
- [ ] Add USB device auto-detection (`lsusb` parser)
- [ ] Add post-install health checks per service
- [ ] Test: fresh Ubuntu 22.04 → wizard → fully working stack

### Phase 6 — Security Hardening (≈ 2 days)
- [ ] Fix NFS exports wildcard
- [ ] Drop `privileged: true` from CUPS/scanservjs
- [ ] Move Samba password to Docker secrets
- [ ] Add HTTPS to nginx (Let's Encrypt or self-signed option in wizard)
- [ ] Add security section to README

---

*Spec version 1.0 — May 2026*
