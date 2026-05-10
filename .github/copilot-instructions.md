# Copilot Instructions — PrinterShare

These instructions apply to all AI-assisted edits in this repository.
Follow them strictly to avoid introducing regressions.

---

## 1. Non-Negotiable: Always Validate Before Finishing

After any non-trivial change, run the full validation suite before declaring the task done:

```bash
cd portal
npm run lint          # must produce 0 errors, 0 warnings
npm run type-check    # must exit 0
npm test              # must pass all unit tests (≥ 42)
```

Do **not** skip these steps. If they fail, fix the failures before moving on.

---

## 2. Test Stability — Do Not Break Existing Tests

- **Never modify a passing test** unless the user explicitly asks.
- E2E selectors **must** use `data-testid`, ARIA roles, or exact-text locators.
  Do NOT use CSS classes, XPath, or positional selectors.
- If adding a new component referenced by an existing E2E test, ensure the
  `data-testid` attribute matches exactly what the test expects.

---

## 3. Settings Schema — Single Source of Truth

The canonical key list lives in `portal/server/routes/settings.js` (`ALLOWED_SETTINGS`).

- **UI keys** (`portal/src/views/SettingsView.vue` field definitions) **must exactly match** the backend allowlist.
- The wizard (`portal/server/routes/wizard.js`) **must use `sanitizePatch`** from `settings.js`
  (or an equivalent validated write path) rather than writing arbitrary keys.
- Never add an env key to the UI without adding it to `ALLOWED_SETTINGS` first.

Current cloud backup keys: `RCLONE_GDRIVE_REMOTE`, `RCLONE_ONEDRIVE_REMOTE`.

---

## 3a. Device Quirks Catalogue — Single Source of Truth

The canonical per-device fix table lives in
`portal/server/data/device-quirks.json` and is consulted by both
`portal/server/lib/device-quirks.js` (server + wizard) and
`scripts/apply-device-quirks.sh` (installer + post-hotplug reconciler).

- **Never hardcode a model check** ("if Samsung SCX-3400 then …") in
  `scripts/proxmox/install.sh`, `scripts/apply-device-quirks.sh`, or any
  portal route. Add or edit a catalogue entry instead.
- The catalogue is the **only** writer of `/etc/sane.d/dll.conf` blacklists.
  Editing `dll.conf` from another shell block is an anti-pattern.
- New entries must follow the schema documented in the README
  ([Device quirks catalogue](../README.md#device-quirks-catalogue)) and
  must be keyed by lowercase `vid:pid` (or `vid:*` vendor wildcard).
- The unit tests in `portal/tests/unit/server/device-quirks.test.ts` must
  continue to pass; add tests for new lookup edge cases.

---

## 4. Security Invariants

- All `/api/v1/*` routes (except `/api/v1/auth/*` and `/api/v1/health`) **must pass through
  the `authMiddleware`** defined in `portal/server/app.js`. Do not add unprotected API routes.
- Shell commands **must** use arg-array form (`spawn(cmd, [arg1, arg2])`) — never interpolate
  user data into a shell command string.
- Do **not** use `v-html` in Vue components.
- `PORTAL_AUTH` defaults should be documented; warn users in `.env.example` to enable it.
- The login endpoint must remain rate-limited (see `portal/server/routes/auth.js`).

---

## 5. TypeScript Strict Compliance

- The portal frontend uses `strict: true` TypeScript. All new `.ts`/`.tsx`/`.vue` files
  must pass `npm run type-check` without errors.
- Do not use `any` unless there is no reasonable alternative.
- Do not suppress type errors with `@ts-ignore` unless accompanied by a comment explaining why.

---

## 6. Docker / Environment Conventions

- Named volume names follow the pattern in `docker-compose.yml`:
  `cups-config`, `cups-ppd`, `portal-data`, `ipp-usb-state`, `rclone-config`,
  `paperless-data`, `paperless-media`, `paperless-db`, `paperless-redis`, `tailscale-state`.
  Scripts (e.g. `scripts/backup.sh`) must use these exact names.
- Optional services (paperless, tailscale, cloudflared) are enabled via `COMPOSE_PROFILES`.
  The health model must distinguish `disabled` (not in profile) from `offline` (in profile but down).
- Do not add `privileged: true` to containers that don't require kernel-level access.
  Currently only `ipp-usb` and `nfs` require elevated privileges.

---

## 7. Commit Hygiene

- Keep commits focused (one concern per commit).
- Commit message format: `type(scope): description` (e.g. `fix(settings): align cloud key names`).
- Do **not** commit `.env`, secrets, or generated build artifacts.

---

## 8. Dependency Policy

- Pin new npm dependencies to an exact version (`--save-exact`).
- Pin new Docker base images to an immutable digest (`@sha256:...`).
- Do not introduce new dependencies without user approval for production code.

---

## 9. Deployment

- The deploy target is a Docker host at **192.168.0.36** (SSH user `alal`).
- **Always deploy via `git pull`** on the remote, never via `rsync`, `scp`, or any
  other file copy. The canonical procedure is:
  1. Commit and push all changes to `origin/main` from the workstation.
  2. SSH to the remote and run `cd ~/printershare && ./scripts/deploy.sh`
     (which runs `git pull --ff-only`, builds the portal, and restarts the stack).
- If the remote working tree is not yet a git clone, bootstrap it once with
  `git init && git remote add origin <url> && git fetch && git reset --hard origin/main`
  inside `~/printershare` — preserving the existing `.env` and any data files.
  After bootstrap, all future deploys use `./scripts/deploy.sh`.
- Never edit files on the remote directly; all changes flow through git.
