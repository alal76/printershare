# PrinterShare User Guide

This guide covers deployment, first-run setup, daily use, and troubleshooting for PrinterShare.

## Set host placeholder once

Define your server address once and reuse it in this guide:

```bash
HOST_IP=<your-server-ip>
```

## 1. Deployment target

This guide assumes PrinterShare is deployed on:
- Host IP: ${HOST_IP}
- Host type: Proxmox LXC container running Docker

Portal endpoints after deployment:
- Portal: http://${HOST_IP}/
- Scan UI: http://${HOST_IP}/scan/
- CUPS: http://${HOST_IP}/cups/

## 2. Prerequisites

Required:
- Proxmox VE node with a USB printer/scanner physically connected
- LXC container configured for Docker
- Docker and Docker Compose plugin installed inside the container
- LAN clients on the same network as ${HOST_IP}

Recommended:
- Static IP reservation for the container
- Updated firmware/drivers for printer/scanner

## 3. Proxmox LXC USB passthrough

Run these commands on the Proxmox node (not inside the LXC container).

### 3.1 Identify container and USB devices

```bash
pct list
lsusb
```

### 3.2 Stop the target container

```bash
pct stop <CTID>
```

### 3.3 Enable required LXC features for Docker

```bash
pct set <CTID> -features nesting=1,keyctl=1
```

### 3.4 Pass USB bus into container

Edit /etc/pve/lxc/<CTID>.conf and add:

```ini
lxc.cgroup2.devices.allow: c 189:* rwm
lxc.mount.entry: /dev/bus/usb dev/bus/usb none bind,optional,create=dir
```

### 3.5 Start and verify

```bash
pct start <CTID>
pct exec <CTID> -- lsusb
```

Expected result:
- The printer/scanner appears in lsusb output from inside the container.

If not visible:
- Replug the USB cable
- Re-run pct exec <CTID> -- lsusb
- Restart the container and check again

## 4. Install and start PrinterShare

Run these commands inside the LXC container.

```bash
git clone https://github.com/your-org/printershare.git
cd printershare
cp .env.example .env
```

Edit .env and set at minimum:
- CUPS credentials
- Samba credentials
- Network and storage values for your LAN

Start the stack:

```bash
docker compose up -d
```

Check status:

```bash
docker compose ps
docker compose logs -f --tail=100
```

## 5. First-run wizard

1. Open http://${HOST_IP}/
2. Complete all wizard steps:
- Prerequisites
- USB detection
- Passwords
- Network
- Cloud (optional)
- Remote access (optional)
- Confirm

When complete, confirm:
- Printer appears in Devices view
- Scan UI opens at /scan/
- Health view reports all core services as healthy

## 6. Client setup

### 6.1 Windows 10/11

- Go to Settings > Bluetooth and devices > Printers and scanners
- Add printer
- If auto-discovery fails, add manually with:
  - http://${HOST_IP}:631/printers/USB-Printer

Samba scans share:
- \\${HOST_IP}\scans

### 6.2 macOS and iOS

- AirPrint should auto-discover the printer
- If needed, add IPP printer manually with:
  - ipp://${HOST_IP}:631/printers/USB-Printer

Samba scans share:
- smb://${HOST_IP}/scans

### 6.3 Linux

```bash
sudo lpadmin -p MyPrinter -E -v ipp://${HOST_IP}:631/printers/USB-Printer -m everywhere
lpoptions -d MyPrinter
```

NFS share example:

```bash
sudo mount -t nfs ${HOST_IP}:/exports/scans /mnt/scans
```

## 7. Daily operations

Common commands (inside project root):

```bash
docker compose ps
docker compose logs -f ps-portal
docker compose logs -f ps-cups
docker compose restart ps-portal
```

Useful URLs:
- Portal dashboard: http://${HOST_IP}/
- CUPS admin (proxied): http://${HOST_IP}/cups/
- Scan UI: http://${HOST_IP}/scan/
- API health: http://${HOST_IP}/api/v1/health

## 8. Backup and upgrade

Backup:

```bash
./scripts/backup.sh
```

Upgrade and redeploy:

```bash
git pull
./scripts/deploy.sh
```

No rebuild redeploy:

```bash
./scripts/deploy.sh --no-build
```

## 9. Troubleshooting

### USB device not detected

- Confirm lsusb works inside the LXC container
- Confirm /dev/bus/usb is mounted in the container
- Restart container and stack:

```bash
pct restart <CTID>
docker compose down
docker compose up -d
```

### CUPS unavailable

- Check service logs:

```bash
docker compose logs --tail=200 ps-cups
docker compose logs --tail=200 ps-nginx
```

- Verify reverse proxy path:
  - http://${HOST_IP}/cups/

### Scanner page unavailable

- Check scan service logs:

```bash
docker compose logs --tail=200 ps-scanservjs
```

- Verify endpoint:
  - http://${HOST_IP}/scan/

### Print jobs stuck

- Open CUPS queue and clear blocked jobs
- Verify printer online state and paper/toner status
- Power cycle printer and re-test from Portal

## 10. Security checklist

Before production use:
- Change all default secrets in .env
- Restrict NFS exports to your actual LAN subnet
- Restrict management access to trusted LAN/VPN only
- Keep Proxmox node and container OS updated
- Keep Docker images updated

## 11. Quick validation checklist

- USB visible in container (lsusb)
- All containers healthy (docker compose ps)
- Portal reachable at http://${HOST_IP}/
- CUPS reachable at /cups/
- Scan UI reachable at /scan/
- Test page prints successfully
- Test scan saves to shared folder
