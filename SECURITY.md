# Security Policy

## Supported Versions

Only the latest commit on `main` receives security fixes.

## Reporting a Vulnerability

**Do not** open a public GitHub issue for security vulnerabilities.

Instead, open a [GitHub private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
or e-mail the maintainer listed in the repository profile.

Include:
- A clear description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

You can expect an acknowledgement within 72 hours and a patch within 14 days for critical issues.

---

## Security Architecture

| Layer | Mechanism |
|---|---|
| **Portal authentication** | Cookie-based HMAC-SHA256 session token with timing-safe comparison |
| **First-login enforcement** | Login with the default `changeme` password triggers a forced password change before accessing any page |
| **Brute-force protection** | In-memory sliding window: 10 failed logins per IP per 15 minutes |
| **API authorisation** | Every `/api/v1/*` route (except `/auth/*` and `/health`) requires a valid session |
| **Secure cookie** | `Secure` flag is set automatically when `X-Forwarded-Proto: https` is present or `PORTAL_SECURE_COOKIES=true` is set |
| **Shell injection prevention** | All child processes use `spawn(cmd, [args])` — user data is never interpolated into shell strings |
| **Settings allow-list** | Only keys in `ALLOWED_SETTINGS` in `portal/server/routes/settings.js` can be written to `.env` |
| **HTML output** | `v-html` is not used in Vue components; user-facing text goes through text interpolation |
| **Secrets in repo** | No secrets committed; `.env` and `portal.env` are `.gitignore`d |
| **PPD upload validation** | Printer driver uploads (`POST /devices/printer/:name/ppd`) are capped at 512KB, must have a `.ppd` extension, and are rejected unless they start with the `*PPD-Adobe:` magic header — plain-text CUPS config, never an executable |
| **No arbitrary driver execution** | Driver installs only ever come from apt (Debian-packaged) or a user-supplied PPD text file; nothing fetches or runs a vendor installer binary. SANE scanner backends are native code with no equivalent upload path, deliberately, to avoid accepting arbitrary code to `dlopen()` as root |
| **Unattended driver installs** | `printershare-hotplug.timer` polls USB changes every 20s and runs `apt-get install` as root for any matched quirks-catalogue package — scoped to the curated `device-quirks.json` catalogue, not arbitrary packages |
| **Audit logging** | Every mutating `/api/v1/*` request (printer/scanner changes, settings updates, driver installs, logins) is logged with the acting user, IP, and status — `journalctl -u printershare-portal -g audit`. Request bodies are never logged, so PATCH `/settings` payloads (which can contain passwords/tokens) never appear in logs |
| **Bounded log retention** | journald is capped at 200MB / 2 weeks (`journald.conf.d/printershare.conf`) and the plain log files the shell-script side writes (hotplug, scan-purge, scheduled backups) are rotated weekly, 4 generations, via `/etc/logrotate.d/printershare` — logs can't silently fill the disk |

---

## Hardening Checklist for Production Deployments

### 1. Change the default password

The default credentials are **admin / changeme**. The portal forces a password change on
the first login with this password, but make sure it is done before anyone else can access
the host.

In `/etc/printershare/portal.env` (native) or `.env` (Docker), verify:

```
PORTAL_AUTH=true
PORTAL_USER=admin
PORTAL_PASS=<strong password set via the portal>
PORTAL_SECRET=<32-byte random hex — openssl rand -hex 32>
```

### 2. Use HTTPS

Terminate TLS at nginx before the portal. Example with a self-signed cert:

```bash
openssl req -x509 -nodes -days 3650 -newkey rsa:4096 \
    -keyout /etc/ssl/private/printershare.key \
    -out    /etc/ssl/certs/printershare.crt \
    -subj   "/CN=$(hostname)"
```

nginx server block addition:

```nginx
listen 443 ssl;
ssl_certificate     /etc/ssl/certs/printershare.crt;
ssl_certificate_key /etc/ssl/private/printershare.key;
ssl_protocols       TLSv1.2 TLSv1.3;
ssl_ciphers         HIGH:!aNULL:!MD5;

server {
    listen 80;
    return 301 https://$host$request_uri;
}
```

For a publicly routable domain use [Certbot / Let's Encrypt](https://certbot.eff.org/).
For a private tunnel with no open ports, enable the Cloudflare Tunnel profile:

```bash
COMPOSE_PROFILES=remote docker compose up -d
```

When running behind an HTTPS proxy, set:
```
PORTAL_SECURE_COOKIES=true
```
so the portal sets the `Secure` flag on the session cookie correctly.

### 3. Restrict network exposure

- Only ports **80** and **443** (nginx) should be reachable from untrusted networks
- CUPS (631), saned (6566), Samba (445), and NFS (2049) must **not** be exposed to the internet
- Restrict NFS exports to your LAN CIDR: `NFS_ALLOWED_SUBNET=192.168.1.0/24`

### 4. Change Samba credentials

The setup wizard auto-generates a random Samba password. To change it manually:

```bash
smbpasswd -a scanner
```

### 5. Keep the host patched

```bash
apt-get update && apt-get upgrade -y
unattended-upgrades   # enable for automatic security patches
```

### 6. Note on unauthenticated endpoints

`GET /api/v1/health` is intentionally unauthenticated so monitoring tools and the
frontend can poll it without a session. It returns service topology (which services are
running, Tailscale IP if present). This is acceptable on a trusted LAN but exposes
internal topology if Tailscale is enabled and points to a wider network.
