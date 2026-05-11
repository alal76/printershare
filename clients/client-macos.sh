#!/bin/bash
# Beta test version v1.2.0
# Connect a macOS client to the printershare server.
# Usage: bash client-macos.sh <SERVER_IP> [smb|nfs|printer|usbip|all]
set -euo pipefail

SERVER_IP="${1:-}"
ACTION="${2:-menu}"
[[ -z "$SERVER_IP" ]] && { echo "Usage: $0 <SERVER_IP> [smb|nfs|printer|usbip|all]"; exit 1; }

SMB_USER="${SMB_USER:-scanner}"
SMB_PASS="${SMB_PASS:-scanner123}"

do_smb() {
    echo "==> Opening Samba share in Finder..."
    open "smb://${SMB_USER}:${SMB_PASS}@${SERVER_IP}/Scans"
    echo "==> Opened smb://${SERVER_IP}/Scans"
    echo ""
    echo "  Persistent CLI mount (requires sudo):"
    echo "  sudo mkdir -p /Volumes/Scans"
    echo "  sudo mount_smbfs '//${SMB_USER}:${SMB_PASS}@${SERVER_IP}/Scans' /Volumes/Scans"
}

do_nfs() {
    echo "==> Mounting NFS share..."
    sudo mkdir -p /Volumes/Scans-NFS
    sudo mount -t nfs -o resvport,rw,soft \
        "${SERVER_IP}:/exports/scans" /Volumes/Scans-NFS
    echo "==> Mounted at /Volumes/Scans-NFS"
}

do_printer() {
    echo "==> Add printer via System Settings -> Printers & Scanners -> + -> IP"
    echo "    Protocol: IPP   Address: ${SERVER_IP}   Queue: /printers/<name>"
    echo ""
    echo "  Or via CLI:"
    lpstat -h "${SERVER_IP}:631" -a 2>/dev/null || true
    read -rp "  Enter CUPS queue name: " PNAME
    lpadmin -h "${SERVER_IP}:631" -p "${PNAME}_lan" -E \
            -v "ipp://${SERVER_IP}:631/printers/${PNAME}" -m everywhere
    lpoptions -d "${PNAME}_lan"
    echo "==> Printer '${PNAME}_lan' added."
}

do_usbip() {
    echo "==> USB/IP on macOS is experimental."
    echo "    Recommended: use usbipkit (https://usbipkit.com) or usbip-win macOS build."
    command -v brew &>/dev/null && brew install usbutils 2>/dev/null || true
    echo "    List devices:  usbip list -r ${SERVER_IP}"
    echo "    Attach:        sudo usbip attach -r ${SERVER_IP} -b <busid>"
}

show_menu() {
    echo ""
    echo "printershare Client (macOS) — server: ${SERVER_IP}"
    echo "  1) Mount Samba share (open in Finder)"
    echo "  2) Mount NFS share"
    echo "  3) Add network printer"
    echo "  4) USB/IP instructions"
    echo "  5) All of the above"
    echo "  q) Quit"
    read -rp "Choice: " C
    case "$C" in
        1) do_smb ;; 2) do_nfs ;; 3) do_printer ;; 4) do_usbip ;;
        5) do_smb; do_nfs; do_printer; do_usbip ;;
        q) exit 0 ;; *) show_menu ;;
    esac
}

case "$ACTION" in
    smb)     do_smb ;;
    nfs)     do_nfs ;;
    printer) do_printer ;;
    usbip)   do_usbip ;;
    all)     do_smb; do_nfs; do_printer; do_usbip ;;
    *)       show_menu ;;
esac
