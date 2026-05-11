# Contributing to PrinterShare

Thank you for helping make PrinterShare work with more printers and scanners.

## The easiest contribution: adding a device

The single most useful contribution is adding an entry to the
[device quirks catalogue](portal/server/data/device-quirks.json).
No Node.js or Vue knowledge required — it's a JSON file.

### 1. Find your device's USB VID:PID

On Linux / the PrinterShare host:

```bash
lsusb | grep -i <your printer brand>
# Example output: Bus 001 Device 003: ID 04e8:344f Samsung Electronics Co., Ltd SCX-3400
# VID:PID = 04e8:344f
```

### 2. Add a catalogue entry

Open `portal/server/data/device-quirks.json` and add an entry:

```jsonc
{
  "04e8:344f": {
    "name":  "Samsung SCX-3400 Series",
    "make":  "samsung",
    "kind":  "mfp",           // printer | scanner | mfp | auto
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

Fields:
| Field | Required | Description |
|---|---|---|
| `name` | yes | Human-readable device name |
| `make` | yes | Manufacturer lowercase (used for driver search) |
| `kind` | yes | `printer`, `scanner`, `mfp`, or `auto` |
| `print.ppd` | no | PPD path — `suld:<file>`, `hplip:<file>`, or a full path |
| `print.packages` | no | apt packages to install for printing |
| `print.uri_hint` | no | Preferred CUPS URI fragment |
| `scan.sane_backend` | no | Preferred SANE backend name |
| `scan.sane_blacklist` | no | Backends to disable in `dll.conf` |
| `scan.packages` | no | apt packages to install for scanning |
| `ipp_usb` | no | `true` / `false` — whether ipp-usb works with this device |
| `airsane` | no | `ok`, `broken`, or `untested` |
| `notes` | no | Free-text notes shown to the user in the wizard |

### 3. Test your entry

```bash
cd portal
npm test                       # must pass all 56 tests
```

Check the wizard shows the right suggestions:
```bash
curl "http://localhost:3000/api/v1/wizard/quirks?vidpid=04e8:344f" | python3 -m json.tool
```

### 4. Open a pull request

Commit with `chore(quirks): add <brand> <model>` and open a PR.
Your fix will benefit every other PrinterShare user with the same device.

---

## Development setup

```bash
git clone https://github.com/alal76/printershare.git
cd printershare/portal
npm install
npm run dev        # starts Vite dev server + Express API with hot reload
```

### Validation before committing

```bash
cd portal
npm run lint        # must be 0 errors, 0 warnings
npm run type-check  # TypeScript strict check — must exit 0
npm test            # must pass all 56 tests
```

All three must pass before a PR will be accepted.

### Test structure

```
portal/tests/
├── unit/
│   ├── server/   Express route tests (supertest + vitest)
│   └── stores/   Pinia store tests (vitest + jsdom)
└── e2e/          Playwright browser tests
```

Run only server unit tests:
```bash
npm run test:server
```

Run only client/store tests:
```bash
npm run test:client
```

---

## Code conventions

- **TypeScript strict** — no `any`, no `@ts-ignore` without explanation
- **No `v-html`** in Vue components
- **Shell commands** use `spawn(cmd, [args])` — never string interpolation
- **New API routes** must go through `authMiddleware` unless explicitly public
- **New settings keys** must be added to `ALLOWED_SETTINGS` in `portal/server/routes/settings.js` before adding to the UI
- Commits follow **`type(scope): description`** — e.g. `fix(scan): handle empty page list`

---

## Reporting bugs

Open a [GitHub issue](https://github.com/alal76/printershare/issues) with:
- PrinterShare version (`cat /opt/printershare/VERSION`)
- OS and install type (native LXC / Docker)
- Printer/scanner model and USB VID:PID (`lsusb`)
- Steps to reproduce
- Relevant log lines (`journalctl -u printershare-portal -n 50`)

For security vulnerabilities see [SECURITY.md](SECURITY.md).
