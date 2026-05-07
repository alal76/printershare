# printershare

Share a USB printer and scanner over your local network from a Linux server to **Windows, macOS, and Linux** clients — using only open-source software.

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
