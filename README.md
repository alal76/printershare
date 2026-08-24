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
| 🌐 **Remote access** | Tailscale VPN (browser login or auth key) + Cloudflare Tunnel (optional) |
| 📱 **Mobile-first PWA** | Vue 3 progressive web app with bottom navigation |
| 🔧 **Device quirks catalogue** | JSON-driven per-device driver/SANE-backend fix table |
| 🔌 **USB hotplug detection** | Polls for USB changes every 20s and installs matching drivers automatically — no re-run of the installer needed |
| 🖨️ **Default printer/scanner** | Explicit "set as default" for both, instead of last-added-wins |
| 🔍 **Driver catalogue search** | Searches the ~14k installed PPDs (foomatic-db + gutenprint + hplip) for printers without driverless support |
| 📎 **PPD upload** | Apply a vendor-supplied `.ppd` directly for printers with no packaged driver |
| 🖨️ **Non-driverless network printers** | `socket://` (raw/JetDirect) and `lpd://` printers, with driver picker |
| 🌐 **Static network scanners** | Register an eSCL/WSD scanner outside the mDNS broadcast domain (different subnet/VLAN) |
| 📝 **Structured logging** | Leveled logger + HTTP/audit request logging; journald retention capped so logs can't fill the disk |
| 🗑️ **Scan retention** | Scan files auto-deleted after 14 days (configurable, 0 = keep forever) via a daily timer |
| 💾 **Scheduled backups** | Weekly config/state backup with 30-day pruning, plus a tested `restore.sh` |
| 📊 **Disk space monitoring** | Dashboard warns before the scans partition fills up |

---

## Architecture

```
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
```

The portal is a **Vue 3 + TypeScript SPA** backed by an **Express 4** API server.
In the native or Proxmox LXC install, the portal process is managed by `systemd` (`printershare-portal.service`).

---

## Quick Start — Native Install (recommended)

Tested on Debian 12 / Ubuntu 22.04 (bare metal or LXC).

```bash
curl -fsSL https://raw.githubusercontent.com/alal76/printershare/main/scripts/install.sh | sudo bash
```

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
   ```bash
   pct list && lsusb
   ```
2. Stop the container, add USB passthrough flags:
   ```bash
   pct stop <CTID>
   pct set <CTID> -features nesting=1,keyctl=1
   ```
3. Edit `/etc/pve/lxc/<CTID>.conf`:
   ```ini
   lxc.cgroup2.devices.allow: c 189:* rwm
   lxc.mount.entry: /dev/bus/usb dev/bus/usb none bind,optional,create=dir
   ```
4. Start and verify:
   ```bash
   pct start <CTID>
   pct exec <CTID> -- lsusb
   ```

---

## Setup Wizard

The wizard runs automatically on first visit and guides you through 7 steps:

1. **Prerequisites** — Verifies USB device visibility
2. **USB Detection** — Identifies printer/scanner, applies device quirks
3. **Passwords** — Sets portal admin password and Samba share password
4. **Network** — Configures HTTPS port and CUPS connection
5. **Cloud** — Optional rclone remote for scan auto-upload
6. **Remote Access** — Optional Tailscale auth key + Cloudflare tunnel token (a browser-based
   Tailscale login, no auth key needed, is also available afterward from Settings → Tailscale)
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
```bash
sudo lpadmin -p MyPrinter -E -v ipp://<host-ip>:631/printers/USB-Printer -m everywhere
lpoptions -d MyPrinter
```

NFS share:
```bash
sudo mount -t nfs <host-ip>:/exports/scans /mnt/scans
```

### Scanning from other devices

The attached scanner is exposed over the network via eSCL/AirScan (`airsaned`), announced
via mDNS — no app or driver install required on:

- **macOS / iOS** — Image Capture / the Notes app's scanner import finds it automatically
- **Linux** — any SANE client (`scanimage -L`, XSane, Simple Scan) sees it as a normal device
- **Windows 10/11** — not natively via Explorer/WIA (that path uses WSD, which nothing in
  this stack currently implements); install the free **Windows Scan** app from the
  Microsoft Store instead, which speaks eSCL directly

On all platforms, the portal's own web UI (`http://<host-ip>/`) works for scanning
regardless of native OS integration — that's the primary interface, the OS-level
integrations above are a convenience layer on top of it.

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
| `SCANS_RETENTION_DAYS` | `14` | Scan files older than this are deleted daily; `0` = keep forever |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` — takes effect on next restart |
| `LOG_FORMAT` | text | Set `json` for one JSON object per log line (log shipping/aggregation) |
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
| `GET`    | `/devices` | USB devices + CUPS printers + SANE scanners |
| `GET`    | `/devices/drivers?q=…` | Search the installed driver/PPD catalogue |
| `POST`   | `/devices/printer` | Add a printer — `ipp(s)://`, `socket://`, `lpd://`, or `usb://`; optional `driver` override |
| `POST`   | `/devices/printer/auto-add` | Register a detected USB printer by vid:pid |
| `DELETE` | `/devices/printer/:name` | Remove a printer from CUPS |
| `POST`   | `/devices/printer/:name/default` | Set as the system default printer |
| `POST`   | `/devices/printer/:name/ppd` | Apply an uploaded vendor `.ppd` file |
| `POST`   | `/devices/printer/:name/test` | Print a test page |
| `POST`   | `/devices/scanner/default` | Set the portal's preferred default scanner |
| `GET`    | `/devices/scanner/network` | List statically-configured network scanners |
| `POST`   | `/devices/scanner/network` | Register a network scanner outside the mDNS broadcast domain |
| `DELETE` | `/devices/scanner/network/:name` | Remove a static network scanner entry |
| `GET`    | `/scans` | List scan files |
| `GET`    | `/scans/context` | Scanner device capabilities proxied from scanservjs |
| `GET`    | `/scans/:filename` | Download a scan file |
| `DELETE` | `/scans/:filename` | Delete a scan file |
| `POST`   | `/scans/combine` | Merge single-page PDFs into one via `pdfunite` |
| `GET`    | `/printer/queue` | CUPS print queue + status |
| `POST`   | `/printer/print` | Upload and print a file |
| `GET`    | `/settings` | Read configuration (secrets redacted) |
| `PATCH`  | `/settings` | Update configuration |
| `POST`   | `/settings/tailscale/login` | Start interactive Tailscale login (no auth key) — returns a login URL |
| `POST`   | `/settings/tailscale/logout` | Disconnect Tailscale |
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

```jsonc
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
```

To add a new device: add an entry keyed by VID:PID from `lsusb`, commit, then reconcile
on the host:

```bash
curl -X POST http://<host-ip>/api/v1/wizard/apply-quirks
```

This reconciliation also runs automatically — `printershare-hotplug.timer` polls the
attached USB device set every 20s and re-applies the quirks catalogue (installing any
newly-required apt packages) whenever it changes, so plugging in a different printer or
scanner after install doesn't require re-running the installer or the wizard. It's a
polling timer rather than a udev rule because `systemd-udevd` cannot run inside an
unprivileged Proxmox LXC container (this project's primary deployment target) — `/sys`
isn't writable there, so udev rules never fire. Check its activity with:

```bash
systemctl status printershare-hotplug.timer
journalctl -t printershare-hotplug -f
```

### Driver detection beyond the quirks catalogue

For devices the quirks catalogue doesn't know about:
1. **Driver-less protocols** — AirPrint / IPP Everywhere (printers) and eSCL/AirScan
   (scanners) work with zero driver install, and are preferred whenever a device supports
   them.
2. **Local driver search** — `GET /api/v1/devices/drivers?q=…` searches the ~14,000 PPDs
   already installed via `foomatic-db` + `gutenprint` + `hplip`, for printers that need a
   real driver (older network printers, `socket://`/`lpd://` raw queues).
3. **PPD upload** — if a printer's driver isn't packaged for Debian, a user-downloaded
   vendor `.ppd` (plain text, not a binary) can be applied directly via
   `POST /api/v1/devices/printer/:name/ppd`.

There is deliberately **no** path that downloads and executes an arbitrary vendor
installer — that would mean running untrusted binaries as root, triggered by a USB event
or a driver search. SANE backends are compiled native code (not a text format like PPD),
so there is no equivalent "upload a scanner driver" feature for the same reason.

---

## Development

```bash
cd portal
npm install

npm run dev          # Vite dev server + Express with hot reload
npm run lint         # ESLint (must be 0 errors, 0 warnings)
npm run type-check   # TypeScript strict check
npm test             # Unit tests — 56 tests across 8 suites
npm run test:e2e     # Playwright E2E tests
```

### Project layout

```
portal/
├── server/                  Express API (CommonJS)
│   ├── app.js               Bare app (used by tests)
│   ├── index.js             Entry point (app.listen)
│   ├── data/
│   │   └── device-quirks.json
│   ├── lib/
│   │   ├── auth.js            Session tokens, rate limiting, password management
│   │   ├── env.js             .env read/write helpers
│   │   ├── device-quirks.js   Quirks catalogue lookup
│   │   ├── scanner-prefs.js   Portal-side "default scanner" preference (SANE has none)
│   │   └── network-scanner.js Static network scanner entries (sane-airscan's airscan.conf)
│   └── routes/              One file per API resource
└── src/                     Vue 3 + TypeScript SPA
    ├── components/
    ├── composables/
    ├── router/
    ├── stores/
    └── views/
```

---

## Deployment

### Deploy script

```bash
./scripts/deploy.sh          # git pull + build portal + restart service
```

On the LXC host this runs:
```bash
cd /opt/printershare
git pull --ff-only
cd portal && npm run build
rm -rf public && cp -r dist public
systemctl restart printershare-portal
```

### Backup & restore

A native/LXC install backs up the portal env file, CUPS config, Samba config,
the network-scanner config, portal state, and scan files (Docker mode backs
up named volumes instead — legacy path, kept for anyone still on it):

```bash
./scripts/backup.sh                  # → backups/YYYY-MM-DD_HH-MM-SS.tar.gz
./scripts/backup.sh --dest /mnt/nas
./scripts/backup.sh --exclude-scans  # config/state only — scans covered by cloud backup already
```

A `printershare-backup.timer` runs this weekly to `/var/backups/printershare`
(installed automatically by `install-native.sh` / `proxmox/install.sh`),
pruning archives older than 30 days. Restore with:

```bash
sudo bash scripts/restore.sh /var/backups/printershare/2026-08-24_03-00-00.tar.gz
```

It lists what it's about to overwrite and asks for confirmation before
touching anything (`--yes` skips the prompt for scripted use), then restarts
the affected services.

### Creating a release

```bash
./scripts/release.sh patch   # bump patch version, tag, push
./scripts/release.sh minor
./scripts/release.sh major
```

---

## Logging, Retention & Backups

Everything below is installed automatically by `install-native.sh` /
`proxmox/install.sh` — nothing here needs manual setup on a fresh install.

**Logging** — the portal logs through `server/lib/logger.js` to
stdout/stderr, which systemd captures into the journal:

```bash
journalctl -u printershare-portal -f          # everything
journalctl -u printershare-portal -f -g audit  # mutating API calls only (who changed what)
```

Every non-GET `/api/v1/*` request (printer/scanner changes, settings
updates, driver installs, logins) is logged at `audit` regardless of
`LOG_LEVEL`, with the acting user, IP, status, and duration — no request
bodies, so secrets in settings PATCHes are never logged. Routine GET
polling logs at `debug`, silent by default. journald itself is capped
(`journald.conf.d/printershare.conf`, 200MB / 2 weeks) so logs can't fill a
small LXC container's disk over time; CUPS, Samba, and nginx already ship
their own logrotate rules, and the shell-script side of this project
(hotplug detection, scan purge, scheduled backups) gets one more —
`/etc/logrotate.d/printershare` — for the plain files those write.

**Scan retention** — `printershare-scan-purge.timer` runs daily and
deletes scan files older than `SCANS_RETENTION_DAYS` (default 14, `0` =
keep forever). Configurable from Settings → Storage & Retention, or by
editing the env file directly. This is independent of the rclone cloud
backup feature — if you rely on that upload instead of local retention,
make sure `SCANS_RETENTION_DAYS` is generous enough to not race an upload.

```bash
journalctl -t printershare-scan-purge -n 20
```

**Backups** — see [Backup & restore](#backup--restore) below.

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
