# PrinterShare — Full Solution Review

Review date: 2026-05-10  
Reviewer: GitHub Copilot  
Scope: entire portal application — server routes, auth, frontend views/stores, Docker configuration, nginx, and the Tailscale visibility change applied in the preceding session.

---

## Summary

The overall architecture is solid. Security invariants from the repo instructions are respected in every route. The Tailscale visibility fix solves the original problem correctly. Two pre-existing issues and three new issues introduced by the fix are documented below, ordered by severity.

---

## Findings

### S1 — High: `checkPrintDriver` uses `shell: true` with unsanitised user input

**File:** `portal/server/routes/wizard.js:177`

```js
const cmd = make
  ? `docker exec ps-cups lpinfo -m 2>&1 | grep -i ${JSON.stringify(make)} | head -5`
  : 'docker exec ps-cups lpinfo -m 2>&1 | head -5';
const lpinfo = execSync(cmd, { timeout: 20000, encoding: 'utf8', shell: true });
```

`make` comes from `req.query.make` — an unvalidated query string parameter. `JSON.stringify` is not a shell-safe escaping function; a value such as `HP; rm -rf /` would be JSON-stringified to `"HP; rm -rf /"`, which the shell interprets as two commands once the quotes are closed by the trailing `"`.  This is a command-injection vector running inside the CUPS container as root.

**Fix:** validate `make` against a known-safe pattern (e.g. `/^[A-Za-z0-9 _-]{1,64}$/`) before using it, and rewrite the call as an arg-array `spawn`/`execFile` piping into a grep, or use `execSync` without `shell: true` and filter the output in JavaScript.

---

### S2 — Medium: `lpadmin` called with string interpolation — partial injection risk

**File:** `portal/server/routes/devices.js:110–140`

```js
run(`lpadmin -p ${name} -E -v ${uri} -m everywhere`, 20_000);
run(`lp -d ${name} /usr/share/cups/data/testprint`, 15_000);
```

`name` and `uri` are validated by `SAFE_NAME` and `SAFE_URI` regexes before use, so injection is currently blocked. However `run()` calls `execSync` with the default `shell: false` behaviour only when no shell metacharacters are present — it actually passes the string to the OS shell because no `shell` option is set and the first argument is treated as a command string by Node's `execSync`. If `SAFE_NAME` or `SAFE_URI` is ever relaxed, this becomes exploitable.

**Fix:** rewrite the three `run()` calls in devices.js to use `spawnSync` with an explicit arg array (matching the pattern already used in `cups-client.js` and `services.js`), removing the dependency on regex validation as the only guard.

---

### S3 — Medium: Tailscale Sharing card shows `Offline` when the remote profile is disabled

**Files:** `portal/src/views/SharingView.vue:213, 277, 283`

The backend returns `{ status: 'disabled' }` for the `tailscale` service when `COMPOSE_PROFILES` does not include `remote`. The Sharing view checks `v-if="tailscaleService"` — which is truthy for any object including `{ status: 'disabled' }` — so the badge always renders. The computed `tailscaleStatus` maps only `ok` and `offline` and falls through to `unknown` for `disabled`, while `tailscaleLabel` maps all non-`ok` states to the string `'Offline'`.

Result: a user who has not enabled Tailscale sees a badge saying **Offline** rather than nothing or **Disabled**.

**Fix:** add a `disabled` branch to `tailscaleStatus` that maps to a neutral display state, and suppress the badge when `tailscaleService.value?.status === 'disabled'`.

---

### S4 — Medium: `tailscaleStatus()` health probe is synchronous and blocks the event loop

**File:** `portal/server/routes/health.js:57–73`

```js
const out = execSync(
  `docker exec ps-tailscale tailscale status --json 2>/dev/null`,
  { timeout: 5000 },
).toString().trim();
```

`GET /api/v1/health` is polled every 30 seconds from the client (via `system.startPolling()` in `DashboardView.vue`). `execSync` blocks the Node.js event loop for up to 5 seconds while Docker CLI executes. During this window every other in-flight API request (scans listing, print queue, SSE log streams) is stalled.

The existing `containerRunning()` helper has the same pattern but a 3-second timeout and is called for five services per request. The Tailscale probe adds a worst-case 5 additional seconds on top.

**Fix:** cache the Tailscale status in a module-level variable and refresh it on a background timer (`setInterval`), or convert the probe to an async `execFile` call so it does not block the event loop.

---

### S5 — Low: `ServiceHealth` TypeScript interface does not model the new `ip` field

**File:** `portal/src/stores/system.ts:4–7`

```ts
interface ServiceHealth {
  status: 'ok' | 'error' | 'offline' | 'unknown'
  message?: string
}
```

The backend now returns `{ status, latency_ms, ip }` for the `tailscale` entry. The store casts the JSON response with `as HealthData`, which silently drops `ip` from the type. The Sharing view works around this with a local cast:

```ts
(tailscaleService.value as { ip?: string } | undefined)?.ip
```

This is technically correct but exposes an inconsistency: `ip` exists on the wire but not in the shared type, so any future consumer of `system.health.services.tailscale.ip` must repeat the same workaround.

**Fix:** extend `ServiceHealth` with an optional `ip?: string` field so the property is type-safe everywhere.

---

### S6 — Low: `disabled` status not in `ServiceHealth` union type

**File:** `portal/src/stores/system.ts:5`

```ts
status: 'ok' | 'error' | 'offline' | 'unknown'
```

The backend returns `'disabled'` for optional services (paperless, tailscale, cloudflare) when their profile is not active. `'disabled'` is not in the union, so any component switch/comparison on `status` does not get TypeScript exhaustiveness checking for that value. Both `TopBar.vue` and `DashboardView.vue` access `status` directly from `system.health.services`, and the `statusBg`/`statusColor` helpers in DashboardView silently treat `'disabled'` as `undefined`, rendering those tiles with no colour.

**Fix:** add `'disabled'` to the `ServiceHealth.status` union and update any colour/label mappings that need a visual treatment for it.

---

## Pre-existing Observations (no change required, noted for awareness)

- **`AUTH_PASS` falls back to `PORTAL_SECRET`** (`lib/auth.js:7`). The same string is used for both the API signing key and the login password if `PORTAL_PASS` is not set. If `PORTAL_SECRET` is left at its default (`changeme-portal-secret`), authentication is trivially bypassable. The `.env.example` documents this, but the defaults are not warned about at startup.
- **`/api/v1/health` is unauthenticated by design** (`app.js:45`). This leaks service topology (which containers are running, Tailscale IP) to any LAN host. Acceptable for this use-case but worth noting if Tailscale exposes the portal to a wider network.
- **Test coverage gap for health route and Sharing view.** No unit test covers the new `tailscaleStatus()` function or the `disabled` vs `offline` rendering path. The existing 42 tests cover env helpers, scans, usb-detect, devices store, and toast store — but no server-side health logic.
- **`TS_HOSTNAME: printershare` is now hardcoded** in `docker-compose.yml`. If two instances of the stack run on the same tailnet they will collide under the same hostname. Consider making it `${HOSTNAME:-printershare}` or an explicit env variable.
- **Sharing page `v-html` on static strings** (`SharingView.vue:182`). The `step` strings rendered via `v-html` are compile-time literals defined in the same file. There is no user-controlled input path, so XSS risk is absent. The `eslint-disable-next-line` comment is appropriate; this is flagged only for completeness.
