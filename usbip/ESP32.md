# USB Printer Sharing with ESP32

> **TL;DR — choose the right chip:**
> - **ESP32-C6**: ❌ no USB host. Cannot share a USB printer over the network. Use it for Thread/Zigbee/BLE instead.
> - **ESP32-S2 / ESP32-S3**: ✅ has USB OTG host. Can run a USB-host print-server firmware.
> - **Original ESP32 (LX6)**: ❌ no USB host (only UART).

This guide covers the **ESP32-S3** path — get a $5 ESP32-S3-DevKitC-1 (or any S3 board with a USB-A host port broken out). The S2 also works but the S3 has more RAM, BLE, and better Arduino support.

---

## Two architectures, pick one

### Option A — JetDirect / raw TCP-9100 print server (recommended)

The ESP32-S3 enumerates the USB printer locally as a USB host, then exposes it as a **raw TCP socket on port 9100** (the JetDirect protocol). CUPS treats it like any network laser printer.

**Pros:**
- Mature firmware exists; minimal RAM pressure.
- Works with any Linux/macOS/Windows print stack.
- Survives the printer being plugged in/out.

**Cons:**
- **Printer must accept raw print data** (PostScript, PCL, ESC/P, or IPP-Everywhere). Most modern HP/Canon/Epson inkjets do *not* — they speak proprietary vendor protocols that need ipp-usb or vendor PPDs to translate.
- No scanner support (one-way only).
- No AirPrint / mDNS unless the firmware adds it.

**Best fit:** PostScript-capable laser printers (Brother HL/MFC PostScript models, HP LaserJet Pro, Xerox, OKI, older Lexmark).

### Option B — USB/IP server on ESP32-S3 (experimental)

Same wire protocol as a Linux USB/IP server. The Docker host attaches the device as if it were locally plugged in, and CUPS / ipp-usb / scanservjs all work transparently.

**Pros:**
- Identical behaviour to a Raspberry Pi USB/IP server.
- Works for *any* USB device class (printers, scanners, AIO units).
- AirPrint and SANE work because the device is "real" to the OS.

**Cons:**
- Firmware projects are hobby-grade and incomplete; large bulk transfers (full-page raster) can crash the ESP32 due to RAM limits (~512 KB).
- You will likely have to fork and patch firmware.

**Best fit:** experimentation; small label printers, single-function devices.

---

## Option A — JetDirect setup (most reliable)

### 1. Hardware

- ESP32-S3-DevKitC-1 (or any S3 board with USB OTG broken out — pins GPIO19 D-, GPIO20 D+).
- A USB-A breakout or OTG cable connected to those two pins + 5V + GND.
- USB printer that supports PostScript or raw PCL.

### 2. Firmware

Two well-maintained projects to start with:

- **[esp32_usb_printer_server](https://github.com/topics/esp32-usb-printer)** — search GitHub for active forks; pick one with recent commits.
- **ESP-IDF `usb_host_lib` + `tinyusb`** — roll your own with `examples/peripherals/usb/host/usb_host_lib` as a starting point and add a TCP listener that pipes socket → bulk-OUT endpoint.

Quickest path: install ESP-IDF v5.2+, clone an existing fork, edit `sdkconfig` for your WiFi credentials, then:

```bash
idf.py set-target esp32s3
idf.py menuconfig    # set WiFi SSID/PSK
idf.py build flash monitor
```

The firmware will print its IP address on boot.

### 3. Add the printer to CUPS

On the Docker host (192.168.0.9):

```bash
# Find the ESP32's IP from your router's DHCP table or the serial monitor output
ESP_IP=192.168.0.XX

# Add via the CUPS admin UI (http://192.168.0.9/cups) or the wizard, or:
docker exec ps-cups lpadmin -p ESP32-Printer \
    -E \
    -v "socket://${ESP_IP}:9100" \
    -m everywhere
```

If `everywhere` (IPP-Everywhere driverless) doesn't auto-configure, install the printer's manufacturer PPD:

```bash
# Brother example
docker exec ps-cups apt-get update
docker exec ps-cups apt-get install -y printer-driver-brlaser
docker exec ps-cups lpadmin -p ESP32-Printer -P /usr/share/ppd/<your.ppd>
```

### 4. Test

```bash
echo "Hello from PrinterShare" | docker exec -i ps-cups lp -d ESP32-Printer
```

---

## Option B — USB/IP setup (experimental)

If you're committed to USB/IP, the firmware to look at is **`usbip-esp32`** style projects. Search GitHub for active S3 forks; the field changes quickly.

Once flashed and on the LAN at `192.168.0.XX`:

```bash
# On the Docker host
sudo bash scripts/install-usbip-client.sh 192.168.0.XX 1-1
```

The script ([scripts/install-usbip-client.sh](../scripts/install-usbip-client.sh)) will:
1. Install `linux-tools` and load `vhci-hcd`.
2. Probe the ESP32 for the device.
3. Create a systemd unit that auto-attaches at boot.
4. Print the new device in `lsusb`.

Then:

```bash
cd ~/printershare && docker compose up -d
```

The CUPS, ipp-usb, and scanservjs containers will now find `/dev/bus/usb/00X/00Y` populated and start cleanly.

---

## Limitations to know up front

| Limitation | Impact |
|---|---|
| ESP32-S3 has ~512 KB SRAM | Large print jobs (high-DPI photo prints) may exhaust buffers and stall mid-page. |
| USB host on S3 is full-speed (12 Mbps) only | Print throughput is fine; high-resolution scans over USB/IP will be slow. |
| Power delivery | The S3 dev board's onboard 5V regulator is weak. Use an externally powered USB hub between S3 and printer for reliability. |
| Firmware is hobby-grade | Expect the occasional reboot; consider the `wdt` watchdog enabled. |
| No vendor driver translation | Inkjets that need ipp-usb won't work via JetDirect. Use Option B (USB/IP) or buy a PostScript laser. |

---

## When to pick a Raspberry Pi instead

If you have a Raspberry Pi Zero 2 W or any spare Linux SBC, use [scripts/install-usbip-server.sh](../scripts/install-usbip-server.sh) on the Pi instead. You get:

- Mature, kernel-level USB/IP implementation.
- Full USB-host stack — works with any printer, scanner, or AIO.
- AirPrint, SANE, ipp-usb all functional.
- No firmware development required.

The ESP32 path is fun and cheap; the Pi path is what you ship.
