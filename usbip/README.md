# USB/IP — Raw USB Port Sharing

USB/IP lets any LAN client use the physical USB device as if it were locally plugged in.
Run the installer on the **Linux server**:

> Set `HOST_IP` to your server address before running client commands:
> ```bash
> HOST_IP=<your-server-ip>
> ```

```bash
make install-usbip
# or:
sudo bash scripts/install-usbip-server.sh
```

## Client instructions

### Linux
```bash
sudo modprobe vhci-hcd
usbip list -r ${HOST_IP}
sudo usbip attach -r ${HOST_IP} -b <busid>
```

### Windows
Download [usbip-win](https://github.com/cezanne/usbip-win/releases),
install the driver, then:
```
usbip.exe list -r %HOST_IP%
usbip.exe attach -r %HOST_IP% -b <busid>
```
Or use the GUI tool [usbipkit](https://usbipkit.com).

### macOS
Experimental — use `clients/client-macos.sh ${HOST_IP} usbip` for instructions.
