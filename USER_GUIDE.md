# PrinterShare User Guide — v1.2.0 Beta

This guide covers installation, first-run setup, daily use, and troubleshooting.

## Set host placeholder once

Define your server address once and reuse throughout this guide:

```bash
HOST_IP=192.168.0.159   # replace with your host IP
```

Portal endpoints after installation:

| Endpoint | URL |
|---|---|
| Portal (login + scan + devices) | `http://${HOST_IP}/` |
| CUPS admin (proxied) | `http://${HOST_IP}/cups/` |
| scanservjs raw UI | `http://${HOST_IP}/scan/` |
| API health check | `http://${HOST_IP}/api/v1/health` |

---

## 1. Installation

### 1.1 Native install (Debian 12 / Ubuntu 22.04 LXC) — recommended


```bash
curl -fsSL https://raw.githubusercontent.com/alal76/printershare/main/scripts/install.sh | sudo bash
```

The installer:
- Installs CUPS, sane-utils, scanservjs, pdfunite (poppler-utils), nginx, Node.js 20
- Clones the repo to `/opt/printershare`
- Prepares the environment and prints next steps
- **To complete install:**
   - For bare metal: `sudo bash scripts/install-native.sh`
   - For Proxmox LXC: `sudo bash scripts/proxmox/install.sh`
- Prints your credentials at the end — **write them down**

Services managed by systemd:
- `printershare-portal` — the Vue 3 portal (Express on port 3000)
- `cups` — CUPS print server
- `scanservjs` — scan backend on port 8080
- `nginx` — reverse proxy on port 80


---

## 2. Proxmox LXC USB passthrough

If the host is an LXC container, USB must be passed through from the Proxmox node.

### 2.1 On the Proxmox node

```bash
pct list                        # find your container ID
lsusb                           # confirm printer is visible on the node
pct stop <CTID>
pct set <CTID> -features nesting=1,keyctl=1
```

Edit `/etc/pve/lxc/<CTID>.conf` and add:

```ini
lxc.cgroup2.devices.allow: c 189:* rwm
lxc.mount.entry: /dev/bus/usb dev/bus/usb none bind,optional,create=dir
```

```bash
pct start <CTID>
pct exec <CTID> -- lsusb     # printer must appear here
```

If the printer is not visible: unplug and replug the USB cable, then re-run the last command.

---

## 3. First login and password change

1. Open `http://${HOST_IP}/` in your browser
2. Log in with:
   - **Username:** `admin`
   - **Password:** `changeme` (or the generated password from the installer summary)
3. If you log in with the default password `changeme`, you will be redirected to the
   **Change Password** page immediately — enter a new password (minimum 8 characters)
4. After changing the password, you land on the dashboard

> as `PORTAL_PASS`. After changing it via the portal, the file is updated automatically —
> no service restart required.
> The generated password from the installer is stored in `/etc/printershare/portal.env`
> as `PORTAL_PASS`. After changing it via the portal, the file is updated automatically —
> no service restart required.

---

## 4. Setup Wizard

The wizard launches automatically when PrinterShare has not been configured yet.

Step-by-step:

| Step | What it does |
|---|---|
| **Prerequisites** | Checks USB visibility and system dependencies |
| **USB Detection** | Reads `lsusb`, matches against the device quirks catalogue, suggests PPD and SANE backend |
| **Passwords** | Sets Samba share password |
| **Network** | Confirms nginx ports and CUPS connection |
| **Cloud** | Optional: configure rclone remote for Google Drive or OneDrive |
| **Remote Access** | Optional: Tailscale auth key + Cloudflare tunnel token (or connect Tailscale later via browser login in Settings — see §8) |
| **Confirm** | Applies device quirks, creates CUPS queue, starts all services |

You can re-run the wizard at any time from the portal settings page, or reset it:

```bash
curl -X POST http://${HOST_IP}/api/v1/wizard/reset
```

---

## 5. Printing

### 5.1 Windows 10/11 (IPP Everywhere — no driver required)

1. **Settings → Bluetooth & devices → Printers & scanners → Add device**
2. Windows auto-discovers the printer on the LAN
3. If not found, click **Add manually** and enter:
   `http://${HOST_IP}:631/printers/USB-Printer`

### 5.2 macOS / iOS (AirPrint)

No setup needed — the printer appears in the Print dialog automatically via Bonjour/mDNS.

### 5.3 Android (Mopria)

1. Install [Mopria Print Service](https://play.google.com/store/apps/details?id=org.mopria.printplugin)
2. Open any app and tap **Print** — the printer is discovered automatically

### 5.4 Linux (CUPS client)

```bash
sudo lpadmin -p MyPrinter -E -v ipp://${HOST_IP}:631/printers/USB-Printer -m everywhere
lpoptions -d MyPrinter
echo "test" | lp
```

### 5.5 Setting a default printer

If you have more than one printer configured, open **Devices** in the portal and click the
star icon on the printer you want as default. Only the *first* printer you add claims the
default slot automatically — adding a second or third printer never silently changes it.

### 5.6 Adding an older network printer (no driverless/IPP Everywhere support)

Most modern network printers support driverless printing and just need their IPP address
(§5.1–5.4). For an older printer that only exposes raw JetDirect (port 9100) or LPD:

1. Open **Devices → Add Network Printer**
2. Enter a name and the address as `socket://<printer-ip>:9100` or `lpd://<printer-ip>/queue`
3. Under **Driver**, search for the printer's make/model (searches the ~14,000 PPDs already
   installed via foomatic-db/gutenprint/hplip) and pick a match
4. If nothing matches and you have a `.ppd` file from the manufacturer's site, add the
   printer first (it gets a generic PostScript driver as a placeholder), then open its
   **Settings → Change Driver** and upload the `.ppd` there

---

## 6. Scanning

Open `http://${HOST_IP}/` and navigate to **Scan**.

### 6.1 Single page scan

1. Select **Format** (PDF High, JPEG High, PNG, etc.)
2. Select **Resolution** (300 dpi is a good default)
3. Select **Color mode** (Color, Grayscale, or Line Art)
4. Click **Scan** — the file appears in the file list when ready
5. Click the file name to download

### 6.2 Multi-page PDF (flatbed)

1. Select a PDF format
2. Check **Multi-page document**
3. Place the first page on the glass and click **Scan page 1**
4. When the scan finishes, replace with the next page and click **Scan page 2**
5. Repeat until all pages are scanned
6. Click **Finish PDF (N pages)** — the pages are merged into a single PDF

### 6.3 ADF auto-feed

1. Load all pages in the ADF tray
2. Select **Source: ADF**
3. Check **Multi-page document**
4. Click **Scan** — scanservjs feeds all pages automatically
5. One multi-page PDF is produced

### 6.4 Advanced image filters

Expand the **Advanced** section to enable optional filters applied during scan:

- **Auto-contrast** — normalises contrast range
- **Auto-levels** — normalises histogram per channel
- **Threshold** — converts to pure black/white (useful for text documents)
- **Blur** — light smoothing
- **More-contrast** — additional contrast boost

### 6.5 OCR formats

Selecting **OCR → PDF** or **OCR → text** runs Tesseract OCR on the scanned image
and embeds a searchable text layer (requires Tesseract to be installed on the host).

### 6.6 Setting a default scanner

If more than one scanner is visible (e.g. a USB scanner plus its own eSCL network
loopback, or several devices), open **Devices** and click the star icon on the one you
want the Scan page to use by default. Without this, the portal just uses whichever
device SANE happens to enumerate first — not necessarily a stable choice.

### 6.7 Adding a network scanner on a different subnet/VLAN

Scanners on the same network segment as the host are found automatically (no setup
needed). For a scanner on a different subnet or VLAN — where mDNS auto-discovery can't
reach it — register it manually:

1. Open **Devices → Network Scanners → Add**
2. Enter a name, its eSCL or WSD URL (e.g. `http://192.168.1.102:9095/eSCL`), and protocol
3. It will then appear in the Scanners list like any auto-discovered device

### 6.8 Scanning from other devices on the network

The attached scanner is exposed to other devices via eSCL/AirScan automatically — see the
[README's Client Setup section](README.md#scanning-from-other-devices) for per-OS
details. In short: macOS, iOS, and Linux discover it with no configuration; Windows needs
the free **Windows Scan** Store app (no native WSD support in this stack).

---

## 7. Scan file access

Scanned files are saved to the scans directory on the host (`/scans`).
They can be accessed from any device on the network:

| Protocol | Address |
|---|---|
| Portal download | `http://${HOST_IP}/` → Scan → file list |
| Samba (Windows/macOS) | `\\${HOST_IP}\scans` or `smb://${HOST_IP}/scans` |
| NFS (Linux/macOS) | `${HOST_IP}:/exports/scans` |

---

## 8. Daily operations

### Native/LXC install (systemd)

```bash
systemctl status printershare-portal
systemctl restart printershare-portal
journalctl -u printershare-portal -f
journalctl -u cups -f
journalctl -u scanservjs -f
journalctl -u nginx -f
```


### Settings

Use the portal **Settings** view to change:
- Portal admin password
- Cloud backup remotes
- Tailscale / Cloudflare config

Or edit the env file directly:
- Native/LXC: `/etc/printershare/portal.env`

After changing the env file in native mode, restart the portal:
```bash
systemctl restart printershare-portal
```

### Connecting Tailscale via browser login

The easiest way to enable Tailscale doesn't need an auth key at all:

1. Open **Settings → Tailscale → Connect via Browser**
2. Click the link that appears and finish signing in — on your phone, laptop, or any
   device, it doesn't have to be the PrinterShare host itself
3. The Settings page updates automatically once you're connected

The **Tailscale Auth Key** field further down (under "Remote Access (Advanced)") is still
available for unattended/scripted provisioning, but isn't needed for normal setup.

---

## 9. Update / redeploy

```bash
./scripts/deploy.sh
```

This runs on the server:
```bash
cd /opt/printershare
git pull --ff-only
cd portal && npm run build
rm -rf public && cp -r dist public
systemctl restart printershare-portal
```

---

## 10. Backup

```bash
./scripts/backup.sh                  # → backups/YYYY-MM-DD_HH-MM-SS.tar.gz
./scripts/backup.sh --dest /mnt/nas
```

The backup includes:
- Scan files (`/scans`)
- CUPS configuration (`/etc/cups`)
- Portal env file (`/etc/printershare/portal.env`)

---

## 11. Troubleshooting

### USB device not detected after boot

```bash
lsusb | grep -i samsung   # verify USB is visible
systemctl restart cups
scanimage -L              # confirm SANE can see the scanner
```

If still missing: unplug and replug the cable, wait 5 seconds, retry.

### A newly plugged-in printer/scanner has no driver

The hotplug timer checks for USB changes every 20s and installs any matching driver
package automatically — no re-run of the installer needed. Check it's running and see
what it did:

```bash
systemctl status printershare-hotplug.timer
journalctl -t printershare-hotplug -n 30
```

If the device isn't in the quirks catalogue at all, use the **Devices** page: for
printers, search the driver catalogue or upload a vendor `.ppd` (see §5.6); for network
scanners on a different subnet, register it manually (see §6.7). There's no equivalent
manual-driver option for USB scanners — SANE backends are native code, not something
safe to accept as an upload; if apt has no matching package, the device isn't supported.

### Cannot log in to the portal

Check the portal service is running:
```bash
systemctl is-active printershare-portal
curl -s http://127.0.0.1:3000/api/v1/health | python3 -m json.tool
```


If the password is unknown, reset it by editing `/etc/printershare/portal.env`:
```ini
PORTAL_PASS=changeme
```
Then restart: `systemctl restart printershare-portal`
Log in with `changeme` — you will be prompted to set a new password.

### CUPS unavailable at /cups/

```bash
systemctl status cups
curl -s http://127.0.0.1:631/
```

### Scan fails or scanner not found

```bash
systemctl status scanservjs
curl -s http://127.0.0.1:8080/api/v1/context | python3 -m json.tool
scanimage -L
```

If the SANE backend is wrong for your device:
```bash
curl http://${HOST_IP}/api/v1/wizard/quirks?vidpid=04e8:344f | python3 -m json.tool
curl -X POST http://${HOST_IP}/api/v1/wizard/apply-quirks | python3 -m json.tool
```

### Print jobs stuck in queue

1. Open `http://${HOST_IP}/cups/` and clear blocked jobs
2. Power-cycle the printer
3. Run a test page from the portal **Devices** view

### Device-specific quirks

PrinterShare maintains a JSON catalogue of known per-device fixes at
`portal/server/data/device-quirks.json`. If your device is misbehaving, check what
the catalogue knows:

```bash
curl "http://${HOST_IP}/api/v1/wizard/quirks?vidpid=$(lsusb | grep -i <brand> | awk '{print tolower($6)}')" | python3 -m json.tool
```

To re-apply fixes without rebooting:
```bash
curl -X POST http://${HOST_IP}/api/v1/wizard/apply-quirks
```

---

## 12. Security checklist

Before sharing the portal on a wider network:

- [ ] Change the default `changeme` password on first login
- [ ] Set a strong `PORTAL_SECRET` (`openssl rand -hex 32`)
- [ ] Verify `PORTAL_AUTH=true` in the env file
- [ ] Restrict NFS exports to your LAN CIDR (`NFS_ALLOWED_SUBNET`)
- [ ] Keep the host OS and packages up to date (`apt-get upgrade`)
- [ ] If exposing to the internet, use HTTPS (Cloudflare Tunnel or nginx + Let's Encrypt)

See [SECURITY.md](SECURITY.md) for detailed hardening instructions.
