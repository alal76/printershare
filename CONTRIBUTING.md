# Contributing to PrinterShare

Thank you for helping make PrinterShare work with more printers and scanners.

## The easiest contribution: adding a device

The single most useful contribution is adding a new entry to the
[device quirks catalogue](portal/server/data/device-quirks.json).
No Node.js or Vue knowledge required — it's just a JSON file.

### 1. Find your device's USB VID:PID

On Linux / the PrinterShare host:

```bash
lsusb | grep -i <your printer brand>
# e.g.  Bus 001 Device 003: ID 04e8:344f Samsung Electronics Co., Ltd SCX-3400 Series
#                                ^^^^ ^^^^
#                                VID  PID
```

### 2. Check if there's already an entry

```bash
cat portal/server/data/device-quirks.json | python3 -m json.tool | grep -A5 '"04e8:344f"'
```

### 3. Add (or edit) the entry

Keys are lowercase `vid:pid` (exact match) or `vid:*` (vendor wildcard).
Copy an existing entry as a template and fill in what applies to your device.

```jsonc
"04e8:344f": {
  "name":  "Samsung SCX-3400 Series",
  "make":  "Samsung",
  "kind":  "mfp",            // mfp | printer | scanner
  "print": {
    "ppd":      "suld:Samsung_SCX-3400_Series.ppd.gz",
    "packages": ["suld-driver2-1.00.39"],
    "uri_hint": "usb"
  },
  "scan": {
    "sane_backend": "smfp",
    "sane_blacklist": ["xerox_mfp"],
    "packages": []
  },
  "ipp_usb":  false,         // true if the device speaks IPP-over-USB
  "airsane":  false,         // true if AirSane (eSCL) works
  "notes":    "Requires Samsung ULD (suldr repo). xerox_mfp conflicts."
}
```

Schema fields you can omit if they don't apply: `print`, `scan`, `ipp_usb`, `airsane`, `notes`.

### 4. Validate the entry

```bash
cd portal
npm test -- --reporter=verbose --grep "device-quirks"
```

All 8 quirks unit tests must still pass, plus any new tests you add for your entry.

### 5. Test on real hardware (if possible)

Run the apply script in dry-run mode on the target host:

```bash
APPLY_BLACKLIST=0 /opt/printershare/scripts/apply-device-quirks.sh
```

It should print `matched <vid:pid> → <name>` for your device.

### 6. Open a pull request

- Title: `feat(quirks): add <make> <model>`
- Include the lsusb output for your device in the PR description
- If you tested on real hardware, say so and describe what works

---

## Code contributions

### Setup

```bash
git clone https://github.com/alal76/printershare.git
cd printershare/portal
npm install
npm run dev        # starts Vite dev server + Express API
```

### Rules (enforced by CI)

```bash
npm run lint       # 0 errors, 0 warnings
npm run type-check # strict TypeScript — no any, no @ts-ignore without comment
npm test           # all unit tests must pass (≥ 52)
```

### Key constraints

- **No hardcoded device logic.** All per-device fixes belong in `portal/server/data/device-quirks.json`.
  See [copilot-instructions.md](.github/copilot-instructions.md) section 3a.
- **No `v-html`** in Vue components. Use `SafeStepText.vue` or structure data instead.
- **All `/api/v1/*` routes** (except `/auth/*` and `/health`) must go through `authMiddleware`.
- **Shell commands** must use `spawn(cmd, [args])` — never string interpolation.
- **New npm packages** must be pinned to an exact version (`--save-exact`).

### Commit format

```
type(scope): description

feat(quirks): add Brother HL-L2350DW entry
fix(scan):    coerce mode list to lowercase before dedup
docs(readme): add HTTPS hardening section
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
