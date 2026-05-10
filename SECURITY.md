# Security Policy

## Supported Versions

Only the latest commit on `main` receives security fixes.
Pin to a specific commit SHA for production deployments.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, e-mail the maintainers at the address listed in the repository profile,
or open a [GitHub private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
for this repository.

Include:

- A clear description of the vulnerability
- Steps to reproduce
- The potential impact
- A suggested fix if you have one

You can expect an acknowledgement within 72 hours and a patch or mitigation
within 14 days for critical issues.

---

## Hardening Checklist for Production Deployments

Follow all of these before exposing PrinterShare to the internet.

### 1. Enable portal authentication

In `.env` (Docker) or `/etc/printershare/portal.env` (native):

```
PORTAL_AUTH=true
PORTAL_USER=admin
PORTAL_PASS=<long random password>
PORTAL_SECRET=<32 random hex chars, e.g. openssl rand -hex 32>
```

The install scripts generate these automatically.
Never use the `changeme` defaults outside of a local test environment.

### 2. Use HTTPS

Terminate TLS at nginx before the portal.  Example with a self-signed cert:

```bash
openssl req -x509 -nodes -days 3650 -newkey rsa:4096 \
    -keyout /etc/ssl/private/printershare.key \
    -out    /etc/ssl/certs/printershare.crt \
    -subj   "/CN=$(hostname)"
```

Then add to your nginx server block:

```nginx
listen 443 ssl;
ssl_certificate     /etc/ssl/certs/printershare.crt;
ssl_certificate_key /etc/ssl/private/printershare.key;
ssl_protocols       TLSv1.2 TLSv1.3;
ssl_ciphers         HIGH:!aNULL:!MD5;
# Redirect HTTP → HTTPS
server {
    listen 80;
    return 301 https://$host$request_uri;
}
```

For a publicly routable domain, use [Certbot / Let's Encrypt](https://certbot.eff.org/)
or enable the Cloudflare Tunnel profile (`COMPOSE_PROFILES=remote`).

### 3. Restrict network exposure

- Bind CUPS (port 631) to loopback only (default in `cupsd.conf`).
- Restrict NFS (`NFS_ALLOWED_SUBNET`) to your LAN CIDR.
- Only expose port 80/443 (nginx) to untrusted networks.
- Do **not** expose saned (port 6566) to the internet.

### 4. Change Samba credentials

The install scripts auto-generate a random Samba password.  To change it:

```bash
smbpasswd -a scanner   # or the SAMBA_USER you configured
```

### 5. Keep the host patched

```bash
apt-get update && apt-get upgrade -y
```

---

## Security Architecture

| Layer | Mechanism |
|---|---|
| Portal authentication | HMAC-SHA256 session token (cookie + Bearer), constant-time comparison |
| Brute-force protection | In-memory sliding window: 10 failed logins per IP per 15 min |
| API authorisation | Every `/api/v1/*` route (except `/auth/*` and `/health`) requires a valid session |
| Shell injection prevention | All child processes use `spawn(cmd, [args])` — no string interpolation |
| Settings allow-list | Only keys in `ALLOWED_SETTINGS` (`settings.js`) can be written to `.env` |
| HTML output | `v-html` is not used; step text is sanitized through `SafeStepText.vue` |
| Secrets in repo | No secrets committed; `.env` and `portal.env` are `.gitignore`d |
