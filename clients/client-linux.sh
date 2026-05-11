#!/bin/bash
# Beta test version v1.2.0
# Connect a Linux client to the printershare server.
# Usage: bash client-linux.sh <SERVER_IP> [usbip|smb|nfs|printer|all]
set -euo pipefail

SERVER_IP="${1:-}"
ACTION="${2:-menu}"
[[ -z "$SERVER_IP" ]] && { echo "Usage: $0 <SERVER_IP> [usbip|smb|nfs|printer|all]"; exit 1; }

SMB_USER="${SMB_USER:-scanner}"
SMB_PASS="${SMB_PASS:-scanner123}"
SMB_MOUNT="/mnt/printershare-scans"
NFS_MOUNT="/mnt/printershare-scans-nfs"

require_root() { [[ $EUID -eq 0 ]] || { echo "Re-run as root for this action."; exit 1; }; }

do_usbip() {
    require_root
    apt-get install -y --no-install-recommends linux-tools-generic "linux-tools-$(uname -r)"
    modprobe vhci-hcd || true
    echo "==> Devices on ${SERVER_IP}:"
    usbip list -r "$SERVER_IP" || true
    read -rp "Enter busid to attach (e.g. 1-2): " BUSID
    usbip attach -r "$SERVER_IP" -b "$BUSID"
    echo "==> Attached. Run 'lsusb' to verify."
}

do_smb() {
    require_root
    apt-get install -y --no-install-recommends cifs-utils
    mkdir -p "$SMB_MOUNT"
    mount -t cifs "//${SERVER_IP}/Scans" "$SMB_MOUNT" \
        -o "username=${SMB_USER},password=${SMB_PASS},iocharset=utf8"
    echo "==> Samba share mounted at ${SMB_MOUNT}"
    read -rp "Add to /etc/fstab? [y/N]: " F
    [[ "$F" =~ ^[Yy]$ ]] && \
        echo "//${SERVER_IP}/Scans ${SMB_MOUNT} cifs username=${SMB_USER},password=${SMB_PASS},iocharset=utf8,_netdev 0 0" >> /etc/fstab && \
        echo "==> Added to /etc/fstab"
}

do_nfs() {
    require_root
    apt-get install -y --no-install-recommends nfs-common
    mkdir -p "$NFS_MOUNT"
    mount -t nfs "${SERVER_IP}:/exports/scans" "$NFS_MOUNT" -o "rw,soft,intr"
    echo "==> NFS mounted at ${NFS_MOUNT}"
    read -rp "Add to /etc/fstab? [y/N]: " F
    [[ "$F" =~ ^[Yy]$ ]] && \
        echo "${SERVER_IP}:/exports/scans ${NFS_MOUNT} nfs rw,soft,intr,_netdev 0 0" >> /etc/fstab && \
        echo "==> Added to /etc/fstab"
}

do_printer() {
    require_root
    apt-get install -y --no-install-recommends cups-client
    echo "==> Printers on ${SERVER_IP}:"
    lpstat -h "$SERVER_IP" -a 2>/dev/null || true
    read -rp "Enter printer queue name: " PNAME
    lpadmin -h "${SERVER_IP}:631" -p "${PNAME}_remote" -E \
            -v "ipp://${SERVER_IP}:631/printers/${PNAME}" -m everywhere
    lpoptions -d "${PNAME}_remote"
    echo "==> Printer '${PNAME}_remote' added and set as default."
}

show_menu() {
    echo ""
    echo "printershare Client — server: ${SERVER_IP}"
    echo "  1) Attach USB/IP device"
    echo "  2) Mount Samba share"
    echo "  3) Mount NFS share"
    echo "  4) Add CUPS printer"
    echo "  5) All of the above"
    echo "  q) Quit"
    read -rp "Choice: " C
    case "$C" in
        1) do_usbip ;; 2) do_smb ;; 3) do_nfs ;; 4) do_printer ;;
        5) do_usbip; do_smb; do_nfs; do_printer ;;
        q) exit 0 ;; *) show_menu ;;
    esac
}

case "$ACTION" in
    usbip)   do_usbip ;;
    smb)     do_smb ;;
    nfs)     do_nfs ;;
    printer) do_printer ;;
    all)     do_usbip; do_smb; do_nfs; do_printer ;;
    *)       show_menu ;;
esac
