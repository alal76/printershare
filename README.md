# PrinterShare

A self-hosted, all-in-one printer and scanner sharing solution built on Docker Compose. Exposes USB printers and scanners over your local network via **AirPrint**, **IPP Everywhere**, **Samba**, and **NFS** — managed through a polished web portal.

---

## Features

| Feature | Details |
|---|---|
| 🖨 **Print sharing** | AirPrint (iOS/macOS), IPP Everywhere (Windows 10/11), Mopria (Android) |
| 🖥 **CUPS web UI** | Proxied at `/cups/` |
| 📄 **Scan to folder** | scanservjs at `/scan/`, files served via the portal |
| 📁 **File sharing** | Samba (SMB) + NFS shares from the scans volume |
| ☁️ **Cloud backup** | rclone auto-upload of scans |
| 🌐 **Remote access** | Tailscale VPN + Cloudflare Tunnel support |
| 📱 **Mobile-first UI** | Progressive Web App with bottom navigation |
| 🔧 **Setup Wizard** | 7-step guided first-run configuration |

---

## Architecture

```
┌─────────────┐   HTTP/HTTPS   ┌──────────────────────────────────────┐
│   Browser   │◄──────────────►│  nginx (port 80/443)                  │
│ iOS/Android │                │  /       → portal:3000                │
│ Windows     │                │  /cups/  → cups:631                   │
│ Linux       │                │  /scan/  → scanservjs:8080            │
└─────────────┘                └──────────────────────────────────────┘
                                         │
              ┌──────────────────────────┼────────────────────────┐
              ▼                          ▼                        ▼
     ┌─────────────────┐     ┌────────────────────┐   ┌─────────────────┐
     │  portal:3000    │     │   cups:631          │   │ scanservjs:8080 │
     │  Vue 3 SPA +    │     │   CUPS + AirPrint   │   │  Web scan UI    │
     │  Express API    │     │   Avahi daemon      │   │                 │
     └─────────────────┘     └────────────────────┘   └─────────────────┘
              │                          │
     ┌────────┴──────┐        ┌──────────┴────────┐
     ▼               ▼        ▼                   ▼
  samba:445      nfs:2049  ipp-usb:631     paperless-ngx
  SMB share      NFS share USB→IPP bridge  Document mgmt
```

---

## Prerequisites

- Docker 24+ and Docker Compose v2
- A Linux host (or Linux VM) with the USB printer/scanner attached
- Port 80/443 open on your router (for remote access)

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/your-org/printershare.git
cd printershare
cp .env.example .env
```

Edit `.env` with your passwords and network settings (or use the Setup Wizard).

### 2. Start the stack

```bash
docker compose up -d
```

Or use the Makefile:

```bash
make up       # start all services
make logs     # tail logs
make down     # stop all services
```

### 3. Open the portal

Navigate to **http://\<host-ip\>** in your browser. The Setup Wizard launches automatically on first run.

For complete setup, operations, and troubleshooting instructions, see [USER_GUIDE.md](USER_GUIDE.md).

---

## Setup Wizard

The wizard guides you through 7 steps:

1. **Prerequisites** — Verifies USB devices are attached and Docker volumes are ready
2. **USB Detection** — Identifies your printer/scanner and assigns CUPS names
3. **Passwords** — Sets Samba share password and portal admin secret
4. **Network** — Configures HTTPS port, CUPS connection, and portal port
5. **Cloud** — Optional rclone remote + bucket for scan auto-upload
6. **Remote Access** — Optional Tailscale auth key + Cloudflare tunnel token
7. **Confirm** — Builds and starts all services

---

## Client Setup

### macOS / iOS (AirPrint)
No configuration needed. Your printer appears in the Print dialog automatically via Bonjour/mDNS.

### Windows 10/11 (IPP Everywhere)
1. Open **Settings → Bluetooth & devices → Printers & scanners**
2. Click **Add device** — Windows discovers the IPP printer automatically
3. If not found, choose **Add manually** and enter:
   ```
   http://<host-ip>:631/printers/USB-Printer
   ```

### Android (Mopria)
1. Install [Mopria Print Service](https://play.google.com/store/apps/details?id=org.mopria.printplugin) from Google Play
2. Open any document and tap **Print** — the printer appears automatically

### Linux (CUPS)
```bash
sudo lpadmin -p MyPrinter -E \
  -v ipp://<host-ip>:631/printers/USB-Printer \
  -m everywhere
lpoptions -d MyPrinter
```

### Samba / Windows File Share
| Platform | Path |
|---|---|
| Windows | `\\<host-ip>\scans` |
| macOS   | `smb://<host-ip>/scans` |
| Android | Connect via a file manager app |

### NFS (Linux/macOS)
```bash
# macOS
mount -t nfs <host-ip>:/data/scans /mnt/scans

# Linux
sudo mount -t nfs <host-ip>:/data/scans /mnt/scans
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORTAL_PORT` | `3000` | Portal Express server port |
| `PORTAL_SECRET` | — | HMAC session secret (set a strong random value) |
| `PORTAL_AUTH` | `false` | Set `true` to enable login (recommended in production) |
| `NGINX_HTTP_PORT` | `80` | nginx HTTP port |
| `NGINX_HTTPS_PORT` | `443` | nginx HTTPS port |
| `CUPS_HOST` | `cups` | CUPS service hostname |
| `CUPS_PORT` | `631` | CUPS service port |
| `SAMBA_PASS` | — | Samba share password |
| `SAMBA_WORKGROUP` | `WORKGROUP` | Samba workgroup name |
| `SAMBA_SHARE` | `scans` | Samba share name |
| `NFS_ALLOWED_SUBNET` | `192.168.0.0/16` | Allowed NFS client network (CIDR) |
| `SCANS_HOST_PATH` | `/srv/printershare/scans` | Host path for scan files |
| `RCLONE_GDRIVE_REMOTE` | — | Rclone remote name for Google Drive cloud upload |
| `RCLONE_ONEDRIVE_REMOTE` | — | Rclone remote name for OneDrive cloud upload |
| `TAILSCALE_AUTH_KEY` | — | Tailscale auth key for VPN |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Cloudflare Tunnel token |
| `COMPOSE_PROFILES` | — | Comma-separated optional profiles: `docs`, `remote` |

See [`.env.example`](.env.example) for the full list with documentation.

---

## Development

```bash
cd portal

# Install dependencies
npm install

# Start dev server (Vite + Express with hot reload)
npm run dev

# Lint
npm run lint
npm run lint:fix

# Type-check
npm run type-check

# Unit tests (client + server)
npm test

# Unit tests with coverage
npm run test:coverage

# E2E tests (requires the portal running at localhost:4173)
npm run test:e2e
npm run test:e2e:ui   # Playwright UI mode
```

### Project layout

```
portal/
├── server/               Express API (CommonJS)
│   ├── app.js            Bare Express app (no listen — used by tests)
│   ├── index.js          Entry point (app.listen)
│   ├── lib/env.js        .env read/write helpers
│   └── routes/           One file per API resource
├── src/                  Vue 3 + TypeScript SPA
│   ├── components/       Reusable UI components
│   ├── composables/      Reusable composition functions
│   ├── router/           Vue Router 4
│   ├── stores/           Pinia stores
│   └── views/            Page-level view components
└── tests/
    ├── setup/            Vitest setup (client + server)
    ├── unit/
    │   ├── server/       Express route tests (supertest)
    │   └── stores/       Pinia store tests (vitest + jsdom)
    └── e2e/              Playwright browser tests
```

---

## API Reference

Base path: `/api/v1`

| Method | Path | Description |
|---|---|---|
| `GET`    | `/health` | Service health check |
| `GET`    | `/system/info` | Host system info |
| `GET`    | `/devices` | USB devices + CUPS printers |
| `POST`   | `/devices/printer` | Add a network printer to CUPS |
| `DELETE` | `/devices/printer/:name` | Remove a printer from CUPS |
| `POST`   | `/devices/printer/:name/test` | Print a test page |
| `GET`    | `/scans` | List scan files |
| `GET`    | `/scans/:filename` | Download a scan file |
| `DELETE` | `/scans/:filename` | Delete a scan file |
| `GET`    | `/printer/queue` | CUPS print queue + status |
| `POST`   | `/printer/print` | Upload and print a file |
| `GET`    | `/settings` | Read configuration (secrets redacted) |
| `PATCH`  | `/settings` | Update configuration |
| `GET`    | `/wizard/state` | Wizard completion state |
| `POST`   | `/wizard/state` | Update wizard step |
| `POST`   | `/wizard/build` | Build and start all services |
| `POST`   | `/wizard/reset` | Reset wizard state |
| `GET`    | `/logs/:service` | Tail service logs |
| `GET`    | `/services` | Docker service status |
| `POST`   | `/services/:name/restart` | Restart a service |

---

## Deployment

### Automated deploy script

```bash
./scripts/deploy.sh                  # pull + build + restart
./scripts/deploy.sh --no-build       # skip image build
./scripts/deploy.sh --env-file /path/to/.env
```

### Proxmox LXC USB passthrough (container host 192.168.0.9)

If your Docker host is an LXC container on Proxmox (for example at `192.168.0.9`), pass the USB bus through from the Proxmox node into that LXC container before starting PrinterShare.

1. On the Proxmox node, identify the LXC ID and USB device:
  ```bash
  pct list
  lsusb
  ```
2. Stop the LXC container:
  ```bash
  pct stop <CTID>
  ```
3. Enable Docker-friendly LXC features:
  ```bash
  pct set <CTID> -features nesting=1,keyctl=1
  ```
4. Edit `/etc/pve/lxc/<CTID>.conf` and add:
  ```ini
  lxc.cgroup2.devices.allow: c 189:* rwm
  lxc.mount.entry: /dev/bus/usb dev/bus/usb none bind,optional,create=dir
  ```
5. Start the container and verify USB visibility inside it:
  ```bash
  pct start <CTID>
  pct exec <CTID> -- lsusb
  ```
6. In the LXC container (`192.168.0.9`), start PrinterShare:
  ```bash
  cd /path/to/printershare
  docker compose up -d
  ```

If `lsusb` inside the container does not show your device, unplug and reconnect the USB cable, then restart the LXC container and retry.

### Backup

```bash
./scripts/backup.sh                  # → backups/YYYY-MM-DD_HH-MM-SS.tar.gz
./scripts/backup.sh --dest /mnt/nas  # custom destination
```

### Creating a release

```bash
./scripts/release.sh patch   # bump patch version, tag, push
./scripts/release.sh minor
./scripts/release.sh major
```

GitHub Actions will automatically:
1. Build and push the Docker image to `ghcr.io`
2. Create a GitHub Release with auto-generated notes

---

## Security

- All secrets are stored in `.env` and never committed
- The portal API redacts sensitive env vars in `GET /settings` responses
- Input validation on all API routes (printer names, URIs, filenames)
- Path traversal protection on all file-serving endpoints
- `X-Powered-By` header disabled

---

## Legacy / Original Components

The following components from the original project remain available:

| Component | Role |
|---|---|
| **USB/IP** | Raw USB port sharing over TCP/IP (`usbip/`) |
| **NFS** | Unix/macOS network file share (`nfs/`) |
| **Samba** | SMB/CIFS share for scan files (`samba/`) |
| **rclone** | Post-scan cloud upload (`scripts/setup-rclone.sh`) |
| **Client scripts** | Platform setup scripts in `clients/` |

---

## Licence

All components are open-source. This configuration is MIT licenced.

## Components

| Component | Role | Project |
|-----------|------|---------|
| **CUPS** | USB printer sharing — IPP + Bonjour auto-discovery | [cups.org](https://www.cups.org) |
| **Scanservjs** | Web UI — scan, preview, download from any browser | [github.com/sbs20/scanservjs](https://github.com/sbs20/scanservjs) |
| **rclone** | Post-scan upload → Google Drive + OneDrive | [rclone.org](https://rclone.org) |
| **Samba** | SMB/CIFS share for scan files (Windows & Mac) | [samba.org](https://www.samba.org) |
| **NFS** | Unix/macOS network file share for scan files | Linux kernel NFS |
| **Nginx** | Reverse proxy — single port 80 entry point | [nginx.org](https://nginx.org) |
| **USB/IP** | Raw USB port sharing over TCP/IP | Linux kernel |

---

## Architecture

```
USB Printer/Scanner  (physical device)
        │ USB cable
        ▼
┌──────────────── Linux Server ──────────────────────┐
│                                                    │
│  ┌──────────┐  ┌────────────┐  ┌───────────────┐  │
│  │  CUPS    │  │ Scanservjs │  │  USB/IP :3240 │  │
│  │  :631    │  │  :8080     │  └───────┬───────┘  │
│  └────┬─────┘  └─────┬──────┘          │          │
│       │              │                 │          │
│  ┌────▼──────────────▼────────┐        │          │
│  │  Nginx reverse proxy  :80  │        │          │
│  └────────────────────────────┘        │          │
│                                        │          │
│  ┌──────────┐  ┌──────────────┐        │          │
│  │  Samba   │  │  NFS :2049   │        │          │
│  │  :445    │  └──────┬───────┘        │          │
└──┼──────────┼─────────┼────────────────┼──────────┘
   │          │         │                │
   └──────────┴─────────┴────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │   LAN Clients              │
          │   Windows / macOS / Linux  │
          └─────────────┬──────────────┘
                        │
          ┌─────────────▼──────────────┐
          │   Cloud Storage            │
          │   Google Drive / OneDrive  │
          └────────────────────────────┘
```

---

## Quick Start (Docker Compose)

**Prerequisites:** Linux server with Docker + Docker Compose v2, USB device plugged in.

```bash
# 1. Clone
git clone https://github.com/alal76/printershare
cd printershare

# 2. Configure
make setup        # creates /srv/printershare/scans + .env
nano .env         # change default passwords

# 3. Build & run
make build
make start
```

| Service | URL / Address |
|---------|---------------|
| Scanner web UI | `http://<SERVER_IP>/` |
| CUPS admin | `http://<SERVER_IP>:631/` |
| Samba share | `\\<SERVER_IP>\Scans` |
| NFS export | `<SERVER_IP>:/exports/scans` |

---

## Add Printer in CUPS

1. Open `http://<SERVER_IP>:631/`
2. Administration → Add Printer → select your USB printer
3. Choose driver (HPLIP for HP, Gutenprint for Epson/Canon, or upload PPD)
4. Printer is now discoverable on the LAN via Bonjour/IPP

---

## Scanner Web UI

Open `http://<SERVER_IP>/` in any browser on the LAN.
- Choose resolution, colour mode, format (PDF / JPEG / PNG)
- Click **Scan** → preview in browser → **Download**
- Files auto-saved to shared folder (`/srv/printershare/scans`)
- If rclone is configured: auto-uploaded to Google Drive + OneDrive

---

## Cloud Upload (rclone)

```bash
# Docker:
docker exec -it ps-scanservjs bash scripts/setup-rclone.sh

# Native:
bash scripts/setup-rclone.sh

# Test:
make test-rclone
```

---

## Client Setup

**Linux**
```bash
bash clients/client-linux.sh <SERVER_IP>
```

**macOS**
```bash
bash clients/client-macos.sh <SERVER_IP>
```

**Windows** — double-click or run as Administrator:
```
client-windows.bat <SERVER_IP>
```

---

## USB/IP (Raw USB Port Sharing)

```bash
# Server
make install-usbip

# Linux client
sudo modprobe vhci-hcd
usbip list -r <SERVER_IP>
sudo usbip attach -r <SERVER_IP> -b <busid>

# Windows — download usbip-win or usbipkit (GUI)
# macOS   — bash clients/client-macos.sh <SERVER_IP> usbip
```

---

## Native Install (No Docker)

```bash
make install-native
make install-usbip   # optional
bash scripts/setup-rclone.sh  # optional cloud upload
```

---

## File Structure

```
printershare/
├── docker-compose.yml
├── .env.example
├── Makefile
├── cups/
│   ├── Dockerfile
│   ├── cupsd.conf
│   └── entrypoint.sh
├── scanservjs/
│   ├── Dockerfile
│   ├── config.js
│   └── scripts/scan-save-upload.sh
├── nginx/nginx.conf
├── nfs/exports
├── usbip/README.md
├── scripts/
│   ├── install-native.sh
│   ├── install-usbip-server.sh
│   └── setup-rclone.sh
└── clients/
    ├── client-linux.sh
    ├── client-macos.sh
    └── client-windows.bat
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SCANS_HOST_PATH` | `/srv/printershare/scans` | Host path for scan files |
| `CUPS_ADMIN_USER` | `admin` | CUPS web admin username |
| `CUPS_ADMIN_PASS` | `changeme` | CUPS web admin password — **change this** |
| `SAMBA_USER` | `scanner` | Samba username |
| `SAMBA_PASS` | `scanner123` | Samba password — **change this** |
| `RCLONE_GDRIVE_REMOTE` | `gdrive` | rclone remote name for Google Drive |
| `RCLONE_ONEDRIVE_REMOTE` | `onedrive` | rclone remote name for OneDrive |
| `NGINX_HTTP_PORT` | `80` | Nginx listen port |
| `SCANSERVJS_PORT` | `8080` | Direct Scanservjs port |

---

## Security Notes

- **Change** default passwords in `.env` before deploying
- Restrict `nfs/exports` to your LAN subnet (e.g. `192.168.1.0/24`) in production
- CUPS admin is HTTP Basic Auth protected
- For internet exposure: add HTTPS via Nginx + Certbot

---

## Licence

All components are open-source. This configuration is MIT licenced.
