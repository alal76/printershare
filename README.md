# PrinterShare — Beta v1.2.0

A self-hosted printer and scanner sharing solution. Exposes a USB all-in-one device over
the local network via **AirPrint**, **IPP Everywhere**, and **Mopria**, with a web portal
for scanning, job management, and configuration.

> **Status:** Beta — running in production on a Proxmox LXC container.

---

## Features

| Feature | Details |
|---|---|
| 🖨 **Print sharing** | AirPrint (iOS/macOS), IPP Everywhere (Windows 10/11), Mopria (Android) |
| 📄 **Scan to PDF/image** | Multi-page flatbed, ADF auto-feed, 11 format + quality options |
| 🔒 **Portal authentication** | Cookie-based session, brute-force rate limiting, forced password change on first login |
| 🧙 **Setup Wizard** | 7-step guided first-run (USB detection, passwords, network, cloud, remote access) |
| 🖥 **CUPS web UI** | Proxied at `/cups/` |
| ☁️ **Cloud backup** | rclone auto-upload of scans (Google Drive + OneDrive) |
| 🌐 **Remote access** | Tailscale VPN + Cloudflare Tunnel (optional) |
| 📱 **Mobile-first PWA** | Vue 3 progressive web app with bottom navigation |
| 🔧 **Device quirks catalogue** | JSON-driven per-device driver/SANE-backend fix table |

---

## Architecture

\`\`\`
USB Printer/Scanner
      │ USB
      ▼
┌───────────── LXC / Linux Host ──────────────────┐
│                                                 │
│  ┌──────────┐  ┌─────────────┐  ┌───────────┐  │
│  │  CUPS    │  │ scanservjs  │  │  Portal   │  │
│  │  :631    │  │  :8080      │  │  :3000    │  │
│  └────┬─────┘  └──────┬──────┘  └─────┬─────┘  │
│       │               │               │        │
│  ┌────▼───────────────▼───────────────▼─────┐  │
│  │          nginx reverse proxy  :80/443     │  │
│  │  /        → portal:3000                  │  │
│  │  /cups/   → cups:631                     │  │
│  │  /scan/   → scanservjs:8080              │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌──────────┐  ┌──────────────┐                 │
│  │  Samba   │  │  NFS :2049   │  (optional)     │
│  │  :445    │  └──────────────┘                 │
└──┴──────────┴────────────────────────────────────┘
\`\`\`

The portal is a **Vue 3 + TypeScript SPA** backed by an **Express 4** API server.
In the native or Proxmox LXC install, the portal process is managed by `systemd` (`printershare-portal.service`).

---

## Quick Start — Native Install (recommended)

Tested on Debian 12 / Ubuntu 22.04 (bare metal or LXC).

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/alal76/printershare/main/scripts/install.sh | sudo bash
\`\`\`

The installer:
1. Installs system packages (CUPS, sane-utils, scanservjs, pdfunite, nginx, Node.js 20)
2. Clones the repo to `/opt/printershare`
3. Prepares the environment and prints next steps
4. **To complete install:**
  - For bare metal: `sudo bash scripts/install-native.sh`
  - For Proxmox LXC: `sudo bash scripts/proxmox/install.sh`
5. Prints a summary with your credentials — **save them**

After install, open **http://\<host-ip\>/** and complete the Setup Wizard.

Default login: **admin / <generated password>** — you will be forced to change the password on first login.

---


## Proxmox LXC USB Passthrough

If the host is an LXC container on Proxmox, pass USB through from the Proxmox node first:

1. On the **Proxmox node**, identify the LXC ID and USB device:
   \`\`\`bash
   pct list && lsusb
   \`\`\`
2. Stop the container, add USB passthrough flags:
   \`\`\`bash
   pct stop <CTID>
   pct set <CTID> -features nesting=1,keyctl=1
   \`\`\`
3. Edit `/etc/pve/lxc/<CTID>.conf`:
   \`\`\`ini
   lxc.cgroup2.devices.allow: c 189:* rwm
   lxc.mount.entry: /dev/bus/usb dev/bus/usb none bind,optional,create=dir
   \`\`\`
4. Start and verify:
   \`\`\`bash
   pct start <CTID>
   pct exec <CTID> -- lsusb
   \`\`\`

---

## Setup Wizard

The wizard runs automatically on first visit and guides you through 7 steps:

1. **Prerequisites** — Verifies USB device visibility
2. **USB Detection** — Identifies printer/scanner, applies device quirks
3. **Passwords** — Sets portal admin password and Samba share password
4. **Network** — Configures HTTPS port and CUPS connection
5. **Cloud** — Optional rclone remote for scan auto-upload
6. **Remote Access** — Optional Tailscale auth key + Cloudflare tunnel token
7. **Confirm** — Starts all services

---

## Scanning

The portal scan page provides:

| Setting | Options |
|---|---|
| **Format** | PDF (High / Medium / Low / Lossless), JPEG (High / Med / Low), PNG, TIFF, OCR→PDF, OCR→text |
| **Resolution** | 150 / 300 / 600 / 1200 dpi |
| **Color mode** | Color, Grayscale, Line Art (B&W) |
| **Source** | Flatbed, ADF |
| **Multi-page PDF** | Flatbed: scan pages one by one, combine to single PDF on finish |
| **ADF auto-feed** | Select ADF + multi-page → single request feeds all pages automatically |
| **Image filters** | Auto-contrast, auto-levels, threshold, blur, more-contrast |

Available format choices are automatically filtered against the scanner's actual capabilities
at page load.

---

## Client Setup

### macOS / iOS (AirPrint)
No configuration needed — the printer appears in the Print dialog automatically via Bonjour.

### Windows 10/11 (IPP Everywhere)
1. **Settings → Bluetooth & devices → Printers & scanners → Add device**
2. If auto-discovery fails, add manually: `http://<host-ip>:631/printers/USB-Printer`

Samba scans share: `\\<host-ip>\scans`

### Android (Mopria)
Install [Mopria Print Service](https://play.google.com/store/apps/details?id=org.mopria.printplugin),
then any app's Print menu will discover the printer.

### Linux
\`\`\`bash
sudo lpadmin -p MyPrinter -E -v ipp://<host-ip>:631/printers/USB-Printer -m everywhere
lpoptions -d MyPrinter
\`\`\`

NFS share:
\`\`\`bash
sudo mount -t nfs <host-ip>:/exports/scans /mnt/scans
\`\`\`

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORTAL_AUTH` | `true` | Enable portal login (`false` only for trusted private LAN) |
| `PORTAL_USER` | `admin` | Portal admin username |
| `PORTAL_PASS` | `changeme` | Portal admin password — **always change on first login** |
| `PORTAL_SECRET` | — | HMAC session secret — generate with `openssl rand -hex 32` |
| `PORTAL_SECURE_COOKIES` | — | Set `true` to force `Secure` cookie flag behind an HTTPS proxy |
| `PORTAL_PORT` | `3000` | Portal Express port |
| `NGINX_HTTP_PORT` | `80` | nginx HTTP port |
| `NGINX_HTTPS_PORT` | `443` | nginx HTTPS port |
| `CUPS_HOST` | `cups` | CUPS hostname |
| `CUPS_PORT` | `631` | CUPS port |
| `SAMBA_PASS` | — | Samba share password |
| `SAMBA_WORKGROUP` | `WORKGROUP` | Samba workgroup |
| `SAMBA_SHARE` | `scans` | Samba share name |
| `NFS_ALLOWED_SUBNET` | `192.168.0.0/16` | Allowed NFS client CIDR |
| `SCANS_PATH` | `/scans` | Scan files directory |
| `SCANSERVJS_URL` | auto | Override scanservjs URL |
| `RCLONE_GDRIVE_REMOTE` | — | rclone remote name for Google Drive |
| `RCLONE_ONEDRIVE_REMOTE` | — | rclone remote name for OneDrive |
| `TAILSCALE_AUTH_KEY` | — | Tailscale auth key for VPN |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Cloudflare Tunnel token |

- Native/LXC install reads from `/etc/printershare/portal.env`

---

## API Reference

All routes under `/api/v1/` except `/auth/*` and `/health` require a valid session cookie
(set by `POST /api/v1/auth/login`).

| Method | Path | Description |
|---|---|---|
| `POST`   | `/auth/login` | Login → sets `ps_session` cookie; returns `mustChangePassword` |
| `POST`   | `/auth/change-password` | Change password (required on first login with `changeme`) |
| `POST`   | `/auth/logout` | Invalidate session |
| `GET`    | `/health` | Service health check (unauthenticated) |
| `GET`    | `/system/info` | Host system info |
| `GET`    | `/devices` | USB devices + CUPS printers |
| `POST`   | `/devices/printer` | Add a network printer to CUPS |
| `DELETE` | `/devices/printer/:name` | Remove a printer from CUPS |
| `POST`   | `/devices/printer/:name/test` | Print a test page |
| `GET`    | `/scans` | List scan files |
| `GET`    | `/scans/context` | Scanner device capabilities proxied from scanservjs |
| `GET`    | `/scans/:filename` | Download a scan file |
| `DELETE` | `/scans/:filename` | Delete a scan file |
| `POST`   | `/scans/combine` | Merge single-page PDFs into one via `pdfunite` |
| `GET`    | `/printer/queue` | CUPS print queue + status |
| `POST`   | `/printer/print` | Upload and print a file |
| `GET`    | `/settings` | Read configuration (secrets redacted) |
| `PATCH`  | `/settings` | Update configuration |
| `GET`    | `/wizard/state` | Wizard completion state |
| `POST`   | `/wizard/state` | Update wizard step |
| `POST`   | `/wizard/build` | Build and start all services |
| `POST`   | `/wizard/reset` | Reset wizard state |
| `GET`    | `/wizard/quirks?vidpid=…` | Per-device driver hints |
| `GET`    | `/wizard/driver-check?vidpid=…&make=…` | Driver availability + quirks lookup |
| `POST`   | `/wizard/apply-quirks` | Reconcile SANE config against connected USB devices |
| `GET`    | `/logs/:service` | Tail service logs |
| `GET`    | `/services` | Service status |
| `POST`   | `/services/:name/restart` | Restart a service |

---

## Device Quirks Catalogue

The canonical per-device fix table lives in
[`portal/server/data/device-quirks.json`](portal/server/data/device-quirks.json).

Keys are lowercase `vid:pid` or `vid:*` vendor wildcards.
Lookup falls back: exact → vendor → make string → none.

\`\`\`jsonc
{
  "04e8:344f": {
    "name":  "Samsung SCX-3400 Series",
    "make":  "samsung",
    "kind":  "mfp",
    "print": {
      "ppd":      "suld:Samsung_SCX-3400_Series.ppd.gz",
      "packages": ["suld-driver2-1.00.39"],
      "uri_hint": "usb://Samsung/SCX-3400%20Series"
    },
    "scan": {
      "sane_backend":   "smfp",
      "sane_blacklist": ["xerox_mfp"],
      "packages":       ["suld-driver2-1.00.39"]
    },
    "ipp_usb": false,
    "airsane": "ok",
    "notes":   "Requires Samsung ULD driver. ipp-usb does not work with this model."
  }
}
\`\`\`

To add a new device: add an entry keyed by VID:PID from `lsusb`, commit, then reconcile
on the host:

\`\`\`bash
curl -X POST http://<host-ip>/api/v1/wizard/apply-quirks
\`\`\`

---

## Development

\`\`\`bash
cd portal
npm install

npm run dev          # Vite dev server + Express with hot reload
npm run lint         # ESLint (must be 0 errors, 0 warnings)
npm run type-check   # TypeScript strict check
npm test             # Unit tests — 56 tests across 8 suites
npm run test:e2e     # Playwright E2E tests
\`\`\`

### Project layout

\`\`\`
portal/
├── server/                  Express API (CommonJS)
│   ├── app.js               Bare app (used by tests)
│   ├── index.js             Entry point (app.listen)
│   ├── data/
│   │   └── device-quirks.json
│   ├── lib/
│   │   ├── auth.js          Session tokens, rate limiting, password management
│   │   ├── env.js           .env read/write helpers
│   │   └── device-quirks.js Quirks catalogue lookup
│   └── routes/              One file per API resource
└── src/                     Vue 3 + TypeScript SPA
    ├── components/
    ├── composables/
    ├── router/
    ├── stores/
    └── views/
\`\`\`

---

## Deployment

### Deploy script

\`\`\`bash
./scripts/deploy.sh          # git pull + build portal + restart service
\`\`\`

On the LXC host this runs:
\`\`\`bash
cd /opt/printershare
git pull --ff-only
cd portal && npm run build
rm -rf public && cp -r dist public
systemctl restart printershare-portal
\`\`\`

### Backup

\`\`\`bash
./scripts/backup.sh                  # → backups/YYYY-MM-DD_HH-MM-SS.tar.gz
./scripts/backup.sh --dest /mnt/nas
\`\`\`

### Creating a release

\`\`\`bash
./scripts/release.sh patch   # bump patch version, tag, push
./scripts/release.sh minor
./scripts/release.sh major
\`\`\`

---

## Security

See [SECURITY.md](SECURITY.md) for the full hardening checklist.

Key points:
- Authentication is **on by default** (`PORTAL_AUTH=true`)
- First login with `changeme` forces an immediate password change
- All `/api/v1/*` routes except `/auth/*` and `/health` require a valid session
- Brute-force protection: 10 failed logins per IP per 15 minutes
- All child processes use `spawn(cmd, [args])` — never string interpolation
- The `Secure` cookie flag is set automatically when the portal detects HTTPS
  via `X-Forwarded-Proto` header or `PORTAL_SECURE_COOKIES=true`

---

## Components

| Component | Role |
|---|---|
| **CUPS** | USB printer sharing — IPP + Bonjour auto-discovery |
| **scanservjs** | Scan backend + preview UI (`/scan/`) |
| **Portal** | Vue 3 SPA + Express API — main user interface |
| **nginx** | Reverse proxy, single port 80/443 entry point |
| **Samba** | SMB/CIFS share for scan files |
| **NFS** | Unix/macOS network file share |
| **rclone** | Post-scan cloud upload (Google Drive / OneDrive) |
| **Tailscale** | Optional VPN for remote access |
| **Cloudflare Tunnel** | Optional HTTPS tunnel (no port-forward needed) |

---

## Licence

MIT
