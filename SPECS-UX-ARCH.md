# printershare — UX, UI & Architecture Specifications

> **Status:** Design / pre-implementation  
> **Principle:** Zero client-side app required for printing, scanning, and document management.  
>   All functionality is delivered through a browser.  
>   USB/IP kernel module on Linux clients is the **only** exception, and that path is optional.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [System Architecture](#2-system-architecture)
3. [Network & Data Flow Diagrams](#3-network--data-flow-diagrams)
4. [Design System](#4-design-system)
5. [Information Architecture](#5-information-architecture)
6. [Portal — The Central Web UI](#6-portal--the-central-web-ui)
7. [Setup Wizard — Detailed UX](#7-setup-wizard--detailed-ux)
8. [Dashboard](#8-dashboard)
9. [Scan Module](#9-scan-module)
10. [Print Module](#10-print-module)
11. [Document Library](#11-document-library)
12. [Settings Module](#12-settings-module)
13. [Mobile UX](#13-mobile-ux)
14. [Component Library](#14-component-library)
15. [API Design](#15-api-design)
16. [Container Architecture](#16-container-architecture)
17. [Persistence & State](#17-persistence--state)
18. [Observability](#18-observability)
19. [Security Architecture](#19-security-architecture)
20. [Implementation Roadmap](#20-implementation-roadmap)

---

## 1. Design Principles

### 1.1 Core philosophy

| Principle | Description |
|---|---|
| **No app required** | Every workflow reachable in any modern browser. Progressive Web App (PWA) manifest so users can optionally "install" to home screen — but the full feature set works without it. |
| **Zero configuration for clients** | Printing works via AirPrint/Mopria/IPP — discovered automatically. Scanning works via browser. No driver, no software, no account required on client devices. |
| **Single entry point** | One URL (`http://<HOST>/` or `https://print.domain.com/`) is the only thing users need to know. |
| **Works offline on LAN** | Core print/scan functions require only LAN connectivity. Cloud sync is additive. |
| **Progressive disclosure** | Simple tasks are one click. Advanced options surface on demand. Power-user settings are in a separate Settings area. |
| **Mobile-first** | Layouts designed for 375 px viewport first, expanded for tablet and desktop. |
| **Opinionated defaults** | Sane defaults for scan resolution (300 dpi), format (PDF), colour mode (auto). Users do not need to configure anything to scan. |
| **Feedback everywhere** | Every action produces immediate visual feedback. Long operations show progress. Errors are human-readable with remediation steps. |

### 1.2 What "no app" means in practice

```
Scenario                           Client needs         Server needs
──────────────────────────────────────────────────────────────────────
Print from macOS                   Nothing              AirPrint / CUPS
Print from iOS / iPadOS            Nothing              AirPrint / CUPS
Print from Android                 Nothing              Mopria / CUPS
Print from Windows 10/11           Nothing              IPP class driver (built-in)
Print from Linux                   Nothing              CUPS IPP
Scan from any device               A browser            scanservjs portal
Scan from macOS (native)           Nothing              eSCL/AirScan via ipp-usb
Scan from iOS (native)             Nothing              eSCL/AirScan via ipp-usb
Upload document to share           A browser            portal upload
View/search scanned documents      A browser            Paperless-ngx via portal
Configure the server               A browser            Setup wizard / Settings UI
USB/IP attach (Linux client)       vhci-hcd kernel mod  usbipd (optional path)
```

---

## 2. System Architecture

### 2.1 High-level service map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PHYSICAL HOST (Linux server)                        │
│                                                                               │
│  USB Bus                                                                      │
│  /dev/bus/usb                                                                 │
│       │                                                                       │
│       ├──► ipp-usb ──────────────────────────────────────────────────────┐   │
│       │    (IPP-over-USB proxy)                                           │   │
│       │    • Exposes printer as ipp://localhost:60000                     │   │
│       │    • Exposes scanner as eSCL://localhost:60000                    │   │
│       │    • Publishes _ipp._tcp + _uscan._tcp via Avahi                  │   │
│       │                                                                   │   │
│       └──► CUPS ─────────────────────────────────────────────────────┐   │   │
│            (print spooler, :631)                                       │   │   │
│            • Consumes ipp://localhost:60000 from ipp-usb               │   │   │
│            • Shares as IPP Everywhere (AirPrint / Mopria)              │   │   │
│            • Publishes _ipp._tcp + _ipps._tcp via Avahi                │   │   │
│                                                                         │   │   │
│  Docker Compose stack ─────────────────────────────────────────────────┼───┘   │
│                                                                         │       │
│  ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │       │
│  │  nginx   │  │  portal    │  │ scanservjs │  │  paperless-ngx     │ │       │
│  │  :80/:443│  │  :3000     │  │  :8080     │  │  :8000             │ │       │
│  │  proxy   │  │  Vue SPA   │  │  SANE UI   │  │  OCR + DMS         │ │       │
│  └────┬─────┘  └─────┬──────┘  └─────┬──────┘  └────────┬───────────┘ │       │
│       │              │               │                    │             │       │
│       └──────────────┴───────────────┴────────────────────┘             │       │
│                                  │                                       │       │
│  ┌──────────────────────────────────────────────────────────────────┐   │       │
│  │  Shared volume: /srv/printershare/scans                          │   │       │
│  │  ┌─────────┐  ┌────────┐  ┌───────────────────────────────────┐ │   │       │
│  │  │  Samba  │  │  NFS   │  │  Tailscale / Cloudflare Tunnel    │ │   │       │
│  │  │  :445   │  │  :2049 │  │  (remote access overlay)          │ │   │       │
│  │  └─────────┘  └────────┘  └───────────────────────────────────┘ │   │       │
│  └──────────────────────────────────────────────────────────────────┘   │       │
└─────────────────────────────────────────────────────────────────────────┴───────┘
```

### 2.2 Request routing map

```
Client browser  ──► nginx :80 / :443
                         │
                 ┌────── ▼ ──────────────────────────────────────────────────┐
                 │  location /              → portal (Vue SPA)    :3000       │
                 │  location /scan/         → scanservjs          :8080       │
                 │  location /docs/         → paperless-ngx       :8000       │
                 │  location /cups/         → CUPS admin          host:631    │
                 │  location /api/          → portal API          :3000/api   │
                 │  location /health        → nginx stub 200                  │
                 │  location /ws/scan/      → scanservjs websocket :8080      │
                 └───────────────────────────────────────────────────────────┘

AirPrint / Mopria (iOS, Android, macOS, Windows)
  ──► mDNS discovery (_ipp._tcp) → CUPS :631  (host network)

eSCL / AirScan (macOS Preview, iOS Files, Windows WSD)
  ──► mDNS discovery (_uscan._tcp) → ipp-usb eSCL endpoint

SMB (Windows Explorer, macOS Finder)
  ──► Samba :445

NFS (Linux, macOS terminal)
  ──► NFS :2049

USB/IP (Linux kernel vhci-hcd, optional)
  ──► usbipd :3240
```

### 2.3 Container dependency graph

```
             ┌─────────┐
             │  nginx  │ ← entry point for all browser traffic
             └────┬────┘
      ┌───────────┼──────────────┐
      ▼           ▼              ▼
  ┌────────┐ ┌──────────┐ ┌──────────────┐
  │ portal │ │scanservjs│ │paperless-ngx │
  └────┬───┘ └────┬─────┘ └──────┬───────┘
       │          │               │
       │     ┌────┴────┐   ┌──────┴──────┐
       │     │  CUPS   │   │  postgres   │
       │     └────┬────┘   └─────────────┘
       │          │         ┌─────────────┐
       │     ┌────┴────┐    │    redis    │
       │     │ ipp-usb │    └─────────────┘
       │     └─────────┘
       │
  ┌────┴──────────────────────────┐
  │  shared volume: /srv/.../scans│
  └───────────────────────────────┘
         │              │
      ┌──┴──┐        ┌──┴──┐
      │samba│        │ nfs │
      └─────┘        └─────┘
```

---

## 3. Network & Data Flow Diagrams

### 3.1 Print flow (AirPrint from iPhone)

```
iPhone                      LAN                     Server
  │                                                     │
  │── mDNS query _ipp._tcp ─────────────────────────── │
  │ ◄─ Bonjour response (CUPS via Avahi) ────────────── │
  │                                                     │
  │── IPP Get-Printer-Attributes ────────────────────── │
  │ ◄─ IPP response (media, resolution, color caps) ─── │
  │                                                     │
  │  [user taps Print]                                  │
  │                                                     │
  │── IPP Print-Job (PWG Raster / PDF payload) ──────── │
  │                                                     CUPS spools job
  │                                                     CUPS sends to ipp-usb
  │                                                     ipp-usb HTTP → USB
  │                                                     Printer prints
  │ ◄─ IPP Get-Job-Attributes response (completed) ──── │
```

### 3.2 Scan flow (browser)

```
Browser                     nginx                   portal       scanservjs
  │                            │                       │               │
  │── GET / ────────────────── │                       │               │
  │ ◄─ Vue SPA HTML ────────── │                       │               │
  │                            │                       │               │
  │── WebSocket /ws/scan/ ───── │ ─── proxy ──────────────────────────►│
  │                            │                       │               │
  │── POST /scan/api/v1/context/                        │               │
  │      { device, resolution, format } ───────────────────────────── ►│
  │                                                                     │ SANE scan
  │ ◄─ SSE / WS progress events (0%...100%) ───────────────────────────│
  │                                                                     │
  │ ◄─ GET /scan/api/v1/files/<id> (download link) ────────────────────│
  │                                                                     │
  │── (background) file copied to /srv/.../scans/ ─────────────────────│
  │                              paperless-ngx picks up and OCRs        │
```

### 3.3 Document retrieval flow

```
Browser                     nginx              paperless-ngx        postgres
  │                            │                     │                  │
  │── GET /docs/ ─────────────►│                     │                  │
  │ ◄─ Paperless SPA ─────────◄│                     │                  │
  │                            │                     │                  │
  │── GET /docs/api/documents/?query=invoice ────────►│                 │
  │                            │                     │── SQL fulltext ──►│
  │                            │                     │◄── results ───────│
  │◄── JSON document list ──────────────────────────◄│                  │
  │                            │                     │                  │
  │── GET /docs/api/documents/42/download/ ──────────►│                 │
  │◄── PDF stream ─────────────────────────────────◄─│                  │
```

### 3.4 Remote access flow (Tailscale)

```
iPhone (LTE)         Tailscale Relay        Home Server (Tailscale node)
    │                      │                           │
    │── WireGuard tunnel ──►│                           │
    │                      │── WireGuard tunnel ───────►│
    │◄─────────────────────────────────────────────────►│
    │                                                   │
    │── ipp://100.x.x.x:631/printers/Printer ──────────►│
    │         (Tailscale IP, direct after peer discovery)│
    │                                                   CUPS spools
    │◄─ IPP response ───────────────────────────────────│
```

---

## 4. Design System

### 4.1 Design tokens

```css
/* Color palette */
--color-primary:       #2563EB;   /* Blue 600 — primary actions */
--color-primary-hover: #1D4ED8;   /* Blue 700 */
--color-primary-light: #DBEAFE;   /* Blue 100 — highlights */
--color-success:       #16A34A;   /* Green 600 */
--color-warning:       #D97706;   /* Amber 600 */
--color-error:         #DC2626;   /* Red 600 */
--color-neutral-50:    #F9FAFB;
--color-neutral-100:   #F3F4F6;
--color-neutral-200:   #E5E7EB;
--color-neutral-300:   #D1D5DB;
--color-neutral-500:   #6B7280;
--color-neutral-700:   #374151;
--color-neutral-900:   #111827;

/* Typography */
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
--text-xs:   0.75rem;    /* 12px */
--text-sm:   0.875rem;   /* 14px */
--text-base: 1rem;       /* 16px */
--text-lg:   1.125rem;   /* 18px */
--text-xl:   1.25rem;    /* 20px */
--text-2xl:  1.5rem;     /* 24px */
--text-3xl:  1.875rem;   /* 30px */

/* Spacing (8px base grid) */
--space-1: 0.25rem;  /* 4px  */
--space-2: 0.5rem;   /* 8px  */
--space-3: 0.75rem;  /* 12px */
--space-4: 1rem;     /* 16px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
--space-12: 3rem;    /* 48px */

/* Radii */
--radius-sm: 0.25rem;
--radius-md: 0.5rem;
--radius-lg: 1rem;
--radius-full: 9999px;

/* Shadows */
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
--shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1);

/* Transitions */
--transition-fast: 150ms ease;
--transition-base: 200ms ease;
--transition-slow: 300ms ease;
```

### 4.2 Iconography

Use [Lucide](https://lucide.dev/) icon set (MIT license, tree-shakeable, SVG).
All icons: 20×20px stroke, 1.5px weight. Accessible: `aria-hidden="true"` + visible text label or `aria-label` for icon-only buttons.

Key icons mapped to portal concepts:
```
Printer       → lucide:printer
Scanner       → lucide:scan
Documents     → lucide:file-text
Dashboard     → lucide:layout-dashboard
Settings      → lucide:settings
Cloud upload  → lucide:cloud-upload
Status OK     → lucide:check-circle-2      (green)
Status warn   → lucide:alert-triangle      (amber)
Status error  → lucide:x-circle            (red)
Status loading→ lucide:loader-circle       (animated spin)
Upload        → lucide:upload
Download      → lucide:download
Search        → lucide:search
User          → lucide:user
Network       → lucide:network
USB           → lucide:usb
```

### 4.3 Motion & animation

- Toast notifications: slide-in from top-right, 300 ms ease-out; auto-dismiss at 4 s
- Page transitions: cross-fade 150 ms
- Progress bars: smooth width transition, 200 ms step interval
- Skeleton loaders: shimmer animation 1.5 s infinite
- Modal: scale 0.95→1.0 + fade, 200 ms ease-out
- No animation on `prefers-reduced-motion: reduce`

### 4.4 Responsive breakpoints

```
xs:  < 480px   (small phone)
sm:  480–767px (large phone)
md:  768–1023px (tablet / landscape phone)
lg:  1024–1279px (small laptop)
xl:  ≥ 1280px  (desktop)
```

---

## 5. Information Architecture

### 5.1 Site map

```
/ (root)
├── /wizard          Setup wizard (shown only on first run OR when unconfigured)
├── /dashboard        System status overview
├── /scan             Scan a document
│   └── /scan/files   Browse / download recent scans
├── /print            Print queue / job status
├── /docs             Document library (Paperless-ngx embed)
│   ├── /docs/upload  Manual document upload
│   └── /docs/search  Full-text search
├── /settings
│   ├── /settings/printer    CUPS printer management (iframe or API)
│   ├── /settings/scanner    Scanner configuration
│   ├── /settings/cloud      rclone / Tailscale / Cloudflare
│   ├── /settings/sharing    Samba / NFS passwords
│   ├── /settings/network    IP, hostname, ports
│   └── /settings/users      (optional: local user accounts)
└── /cups             CUPS admin iframe (shown in sidebar, accessible via /cups/)
```

### 5.2 Navigation model

**Primary navigation** — persistent left sidebar on desktop, bottom tab bar on mobile:

```
[icon] Dashboard
[icon] Scan
[icon] Print
[icon] Documents
[icon] Settings
```

**Secondary navigation** — breadcrumb within each section.

**Contextual navigation** — action buttons on cards (Scan again, Download, Share).

---

## 6. Portal — The Central Web UI

### 6.1 Overview

The **portal** is a new lightweight Vue 3 single-page application served by a
new `portal` Docker service. It acts as the unified front door, aggregating:
- System health status
- Scan trigger and file access
- Print queue visibility
- Document search (embedding Paperless-ngx)
- All settings and the setup wizard

The portal calls internal APIs (portal backend + scanservjs REST + Paperless-ngx
REST) and never requires the user to navigate to separate ports or services.

### 6.2 Portal service spec

```yaml
# docker-compose.yml
portal:
  build:
    context: ./portal
  container_name: ps-portal
  restart: unless-stopped
  ports:
    - "${PORTAL_PORT:-3000}:3000"
  environment:
    NODE_ENV:               production
    CUPS_HOST:              host.docker.internal
    CUPS_PORT:              631
    SCANSERVJS_INTERNAL:    http://ps-scanservjs:8080
    PAPERLESS_INTERNAL:     http://ps-paperless:8000
    PORTAL_SECRET:          ${PORTAL_SECRET:-changeme}
    PORTAL_AUTH_ENABLED:    ${PORTAL_AUTH:-false}
  volumes:
    - ${SCANS_HOST_PATH:-/srv/printershare/scans}:/scans:ro
    - portal-data:/app/data
```

### 6.3 Portal technology stack

```
portal/
├── Dockerfile
├── package.json
├── vite.config.ts
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── router/index.ts           (vue-router 4)
│   ├── stores/                   (pinia)
│   │   ├── system.ts             service health
│   │   ├── scan.ts               scan state
│   │   ├── print.ts              queue state
│   │   └── docs.ts               document list
│   ├── views/
│   │   ├── WizardView.vue
│   │   ├── DashboardView.vue
│   │   ├── ScanView.vue
│   │   ├── PrintView.vue
│   │   ├── DocsView.vue
│   │   └── SettingsView.vue
│   ├── components/               (reusable)
│   │   ├── layout/
│   │   │   ├── AppShell.vue
│   │   │   ├── Sidebar.vue
│   │   │   ├── BottomNav.vue
│   │   │   └── TopBar.vue
│   │   ├── ui/
│   │   │   ├── Button.vue
│   │   │   ├── Card.vue
│   │   │   ├── StatusBadge.vue
│   │   │   ├── ProgressBar.vue
│   │   │   ├── Toast.vue
│   │   │   ├── Modal.vue
│   │   │   ├── Skeleton.vue
│   │   │   └── Dropdown.vue
│   │   ├── wizard/
│   │   │   ├── WizardShell.vue
│   │   │   ├── StepPrereqs.vue
│   │   │   ├── StepUsbDetect.vue
│   │   │   ├── StepPasswords.vue
│   │   │   ├── StepCloud.vue
│   │   │   ├── StepRemote.vue
│   │   │   └── StepConfirm.vue
│   │   ├── scan/
│   │   │   ├── ScanControls.vue
│   │   │   ├── ScanPreview.vue
│   │   │   ├── ScanProgress.vue
│   │   │   └── FileList.vue
│   │   └── print/
│   │       ├── PrintQueue.vue
│   │       └── PrintJobRow.vue
│   └── api/
│       ├── cups.ts               CUPS IPP REST shim
│       ├── scan.ts               scanservjs REST
│       ├── docs.ts               Paperless REST
│       └── system.ts             portal health API
└── server/                       Node.js/Express backend
    ├── index.ts
    ├── routes/
    │   ├── health.ts
    │   ├── system.ts
    │   ├── cups.ts               proxy + parse CUPS IPP
    │   ├── wizard.ts             wizard state machine
    │   └── settings.ts           read/write .env
    └── services/
        ├── usb-detect.ts         parse lsusb output
        ├── cups-client.ts        IPP client (node-ipp)
        └── docker-compose.ts     restart/status services
```

### 6.4 App shell layout

#### Desktop (≥ 1024 px)
```
┌──────────────────────────────────────────────────────────────────────┐
│ ┌──────────────┐  ┌────────────────────────────────────────────────┐ │
│ │              │  │ TopBar: breadcrumb          🔔 status indicator │ │
│ │  Sidebar     │  ├────────────────────────────────────────────────┤ │
│ │              │  │                                                │ │
│ │  🖥 Dashboard  │  │                                                │ │
│ │  📷 Scan      │  │                  Main content area             │ │
│ │  🖨 Print     │  │                  (scrollable)                  │ │
│ │  📄 Documents │  │                                                │ │
│ │  ⚙ Settings  │  │                                                │ │
│ │              │  │                                                │ │
│ │  ──────────  │  │                                                │ │
│ │  server name │  │                                                │ │
│ │  192.168.1.x │  └────────────────────────────────────────────────┘ │
│ └──────────────┘                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

#### Mobile (< 768 px)
```
┌───────────────────────────┐
│ ≡  printershare      ● ● ● │  ← Top bar with hamburger + status dots
├───────────────────────────┤
│                           │
│    Main content area      │
│    (full width)           │
│                           │
│                           │
│                           │
├───────────────────────────┤
│  🖥   📷   🖨   📄   ⚙   │  ← Bottom tab bar
└───────────────────────────┘
```

---

## 7. Setup Wizard — Detailed UX

### 7.1 Trigger conditions

The wizard opens automatically when:
- The portal detects no `.env` has been written (first run)
- A required service (CUPS, scanservjs) fails health check on startup
- The user navigates to `/wizard` manually

### 7.2 Wizard shell layout

```
┌────────────────────────────────────────────────────────────────┐
│                        printershare                            │
│                     Initial Setup Wizard                       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Step indicator:                                               │
│  ① Prerequisites  ② Devices  ③ Security  ④ Cloud  ⑤ Remote  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━        │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                                                          │ │
│  │              Step content area                           │ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  [← Back]                              [Next →] or [Finish]   │
└────────────────────────────────────────────────────────────────┘
```

Progress is **persisted in localStorage** so a page refresh restores the user's
place in the wizard. The wizard is also resumable after Docker restarts.

### 7.3 Step 1 — Prerequisites

**Purpose:** Run automated checks before proceeding. Block user on hard failures,
warn on soft issues.

```
┌─────────────────────────────────────────────────────────────────┐
│  Prerequisites Check                                             │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  ✅  Docker Engine 27.0 detected                                │
│  ✅  Docker Compose v2.28 detected                              │
│  ✅  Running as user 'alal' (docker group ✓)                    │
│  ✅  Port 80 available                                          │
│  ✅  Port 631 available                                         │
│  ⚠️  Port 445 in use — Samba will be skipped if unresolved      │
│  ✅  Internet connectivity (for image pull)                     │
│  ✅  /srv/printershare/scans writable                           │
│                                                                  │
│  1 warning — you may continue, or resolve the warning first.    │
│                                                                  │
│  [Re-run checks]                           [Continue →]         │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:** Portal backend calls `docker version`, `ss -tlnp`, `curl`,
`ls -la` via Node.js `child_process` and returns JSON status to the SPA.

**States per check:**
- `pending` — grey spinner
- `ok` — green check + description
- `warning` — amber triangle + inline fix suggestion
- `error` — red X + blocking message + fix button where automatable

### 7.4 Step 2 — Device Detection

**Purpose:** Auto-detect USB printer/scanner. Let user confirm or manually specify.

```
┌─────────────────────────────────────────────────────────────────┐
│  USB Devices                                                     │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Detected USB devices:                                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ☑  🖨  HP LaserJet Pro M404n                            │   │
│  │       VID:PID 03f0:2b17  ·  Bus 1, Port 1.2             │   │
│  │       Class: Printer (07)                                │   │
│  │       Capabilities: Print ✓  Scan ✗  Fax ✗              │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ☑  📷  Canon CanoScan LiDE 300                          │   │
│  │       VID:PID 04a9:190d  ·  Bus 1, Port 1.3             │   │
│  │       Class: Imaging (0e)                                │   │
│  │       Capabilities: Print ✗  Scan ✓  eSCL ✓             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  [↻ Rescan]   Device not listed? [Enter manually]               │
│                                                                  │
│  [← Back]                                       [Continue →]    │
└─────────────────────────────────────────────────────────────────┘
```

**Manual entry fallback:**
```
  VID (hex): [____]   PID (hex): [____]   Description: [__________]
```

**Implementation:** Backend runs `lsusb -v` and parses Class codes (07 = printer,
0e = scanner, ff = vendor-specific MFP). Known VID:PID database cross-referenced
with a bundled JSON file (`portal/server/data/usb-devices.json`) to auto-fill
make/model strings and capability hints.

### 7.5 Step 3 — Security Configuration

**Purpose:** Set all passwords. Never leave defaults in production.

```
┌─────────────────────────────────────────────────────────────────┐
│  Security                                                        │
│  ─────────────────────────────────────────────────────────────  │
│  Set strong passwords for each service.                          │
│  These are stored in .env on the server — not transmitted.      │
│                                                                  │
│  CUPS Admin                                                      │
│  Username:  admin  (fixed)                                       │
│  Password:  [●●●●●●●●●●●●]  [👁]   Strength: ████████ Strong   │
│             ✅ Confirm:  [●●●●●●●●●●●●]                         │
│                                                                  │
│  ────────────────────────────────────────────────────────────   │
│  Samba Share (for Windows / macOS network drive)                │
│  Username:  [scanner        ]                                    │
│  Password:  [●●●●●●●●●●●●]  [👁]   Strength: ████████ Strong   │
│             ✅ Confirm:  [●●●●●●●●●●●●]                         │
│                                                                  │
│  ────────────────────────────────────────────────────────────   │
│  Portal Admin (optional — leave blank to allow open access)     │
│  Password:  [                              ]                     │
│  ℹ  If set, all portal pages require a password.                │
│                                                                  │
│  [← Back]                                       [Continue →]    │
└─────────────────────────────────────────────────────────────────┘
```

**Password strength meter:** Implements zxcvbn or a simple entropy score:
- < 40 bits: Weak (red)
- 40–59 bits: Fair (amber)
- ≥ 60 bits: Strong (green)

**Validation rules:**
- Minimum 10 characters
- At least 1 uppercase, 1 lowercase, 1 digit
- Cannot be a common word from a built-in list (top 1000 passwords)
- Confirm field must match

### 7.6 Step 4 — Cloud Upload (optional)

```
┌─────────────────────────────────────────────────────────────────┐
│  Cloud Upload  (optional)                                        │
│  ─────────────────────────────────────────────────────────────  │
│  Scans can be automatically uploaded to cloud storage.           │
│                                                                  │
│  ┌──────────────────────┐  ┌──────────────────────┐             │
│  │  ☐  Google Drive     │  │  ☐  Microsoft OneDrive│             │
│  │     gdrive:Scans/    │  │     onedrive:Scans/   │             │
│  │     [Configure →]    │  │     [Configure →]     │             │
│  └──────────────────────┘  └──────────────────────┘             │
│                                                                  │
│  Clicking Configure opens an rclone OAuth flow in a new tab.    │
│  Come back to this page once authorised.                         │
│                                                                  │
│  Status:  Google Drive: ✅ Connected   OneDrive: ○ Not set      │
│                                                                  │
│  [Test Upload]                                                   │
│                                                                  │
│  [← Back]                      [Skip]         [Continue →]      │
└─────────────────────────────────────────────────────────────────┘
```

**rclone OAuth flow:**
The portal backend spawns `rclone config create` in a subprocess and serves
the OAuth redirect URL to the browser. The user completes OAuth in a new tab;
the backend detects completion and updates the status badge to ✅.

### 7.7 Step 5 — Remote Access (optional)

```
┌─────────────────────────────────────────────────────────────────┐
│  Remote Access  (optional)                                       │
│  ─────────────────────────────────────────────────────────────  │
│  Access your printer and scanner from outside your home network. │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ◉  Tailscale  (Recommended)                             │   │
│  │                                                          │   │
│  │     A free, zero-config VPN. Print from anywhere with   │   │
│  │     AirPrint / Mopria as if you were home.              │   │
│  │                                                          │   │
│  │     Auth Key:  [____________________________]  [Get key→]│   │
│  │     (from https://login.tailscale.com/admin/settings)   │   │
│  │                                                          │   │
│  │     Status: ○ Not connected                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ○  Cloudflare Tunnel  (Scan web UI only, no VPN needed) │   │
│  │                                                          │   │
│  │     Your scan UI at https://[your-name].trycloudflare.com│   │
│  │     Tunnel Token:  [________________________]            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ○  None — LAN access only                                      │
│                                                                  │
│  [← Back]                      [Skip]         [Continue →]      │
└─────────────────────────────────────────────────────────────────┘
```

### 7.8 Step 6 — Review & Build

```
┌─────────────────────────────────────────────────────────────────┐
│  Ready to Build                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  Review your configuration:                                      │
│                                                                  │
│  Devices                                                         │
│    Printer:   HP LaserJet Pro M404n  (USB 03f0:2b17)     [edit] │
│    Scanner:   Canon LiDE 300         (USB 04a9:190d)     [edit] │
│                                                                  │
│  Security                                                        │
│    CUPS:      admin / [set]                              [edit] │
│    Samba:     scanner / [set]                            [edit] │
│    Portal:    Open access                                [edit] │
│                                                                  │
│  Cloud                                                           │
│    Google Drive:  gdrive:Scans/ ✅                       [edit] │
│    OneDrive:      Not configured                         [edit] │
│                                                                  │
│  Remote Access                                                   │
│    Tailscale:  Configured ✅                             [edit] │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ☑  I understand that CUPS and Samba will be accessible  │   │
│  │     on my local network.                                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  [← Back]                                    [Build & Start 🚀] │
└─────────────────────────────────────────────────────────────────┘
```

### 7.9 Step 7 — Build Progress

Full-page build log with live streaming output:

```
┌─────────────────────────────────────────────────────────────────┐
│  Building...                                                     │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  ✅  Writing .env                                               │
│  ✅  Creating /srv/printershare/scans                           │
│  ✅  Pulling nginx:alpine                                       │
│  ✅  Pulling ghcr.io/openprinting/ipp-usb:latest               │
│  ⏳  Building ps-cups  ████████████░░░░░░  62%                  │
│  ⏸  ps-scanservjs  (queued)                                    │
│  ⏸  ps-portal      (queued)                                    │
│  ⏸  ps-paperless   (queued)                                    │
│                                                                  │
│  Build log:                                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ [00:12] Step 3/8 : RUN apt-get update                    │   │
│  │ [00:18] Step 4/8 : RUN apt-get install -y cups...        │   │
│  │ [00:34] Step 5/8 : COPY cupsd.conf /etc/cups/            │   │
│  └──────────────────────────────────────────────────────────┘   │
│  (live streaming via Server-Sent Events)                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

On completion:
```
┌─────────────────────────────────────────────────────────────────┐
│  ✅  Setup Complete!                                            │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Your printershare is ready.                                     │
│                                                                  │
│  Scanner Web UI    http://192.168.1.50/              [Open]     │
│  CUPS Admin        http://192.168.1.50/cups/         [Open]     │
│  Documents         http://192.168.1.50/docs/         [Open]     │
│  Samba Share       \\192.168.1.50\Scans                         │
│  AirPrint          Auto-discovered on your network  ✅          │
│  Tailscale         100.64.12.34 (connected)          ✅          │
│                                                                  │
│  [Send test print]      [Test scan]                             │
│                                                                  │
│  [Go to Dashboard →]                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Dashboard

### 8.1 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard                                    Last updated: now  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐   │
│  │  🖨  Printer              │  │  📷  Scanner                 │   │
│  │  HP LaserJet M404n       │  │  Canon LiDE 300              │   │
│  │  ● Online                │  │  ● Online                    │   │
│  │  Ink: ████░░  73%        │  │  AirScan: ✅                  │   │
│  │  Queue: 0 jobs           │  │  SANE: ✅                     │   │
│  │  [Print test page]       │  │  [Scan now →]                 │   │
│  └─────────────────────────┘  └─────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐   │
│  │  ☁  Cloud Sync           │  │  🌐  Remote Access           │   │
│  │  Google Drive: ✅         │  │  Tailscale: ✅ 100.64.12.34  │   │
│  │  Last sync: 2 min ago    │  │  Cloudflare: ✅ scan.acme.com │   │
│  │  23 files synced         │  │  LAN: 192.168.1.50           │   │
│  └─────────────────────────┘  └─────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Services                                                │    │
│  │  CUPS ✅   scanservjs ✅   Samba ✅   NFS ✅   ipp-usb ✅ │    │
│  │  Paperless ✅   Redis ✅   Postgres ✅   Nginx ✅          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Recent Activity                                         │    │
│  │  ─────────────────────────────────────────────────────  │    │
│  │  📷 Scan completed  ·  scan_2026-05-07_143201.pdf  2m    │    │
│  │  🖨 Print job sent   ·  Invoice.pdf               15m   │    │
│  │  ☁  Uploaded 3 files to gdrive:Scans/2026-05-07/  1h   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Service status polling

The portal polls `/api/health` every 30 seconds. Each service check:

| Service | Check method | Healthy criterion |
|---|---|---|
| CUPS | HTTP GET `host:631/` < 5 s | 200 OK |
| ipp-usb | Check container running + device file | Container up |
| scanservjs | HTTP GET `ps-scanservjs:8080/api/v1/context` | 200 OK |
| Paperless-ngx | HTTP GET `ps-paperless:8000/api/` | 200 OK |
| Samba | `smbclient -L localhost -N` | Exit 0 |
| NFS | `showmount -e localhost` | Exit 0 |
| Tailscale | `tailscale status` | "Running" |
| Cloudflare | Container up + tunnel established | Container up |

### 8.3 Quick actions

Large tap-friendly buttons visible on dashboard without scrolling:

```
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  📷            │  │  📄            │  │  🖨            │
│   Scan Now    │  │  Upload Doc   │  │  Print File   │
│               │  │               │  │               │
└───────────────┘  └───────────────┘  └───────────────┘
```

---

## 9. Scan Module

### 9.1 Scan page layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Scan a Document                                                 │
├────────────────────────────────┬────────────────────────────────┤
│  Controls                      │  Preview                       │
│                                │                                │
│  Device                        │  ┌──────────────────────────┐ │
│  [Canon LiDE 300          ▼]   │  │                          │ │
│                                │  │   Scan preview           │ │
│  Source                        │  │   appears here           │ │
│  ◉ Flatbed   ○ ADF             │  │   after scan             │ │
│                                │  │                          │ │
│  Resolution                    │  └──────────────────────────┘ │
│  ○ 150 dpi  ◉ 300 dpi          │                               │
│  ○ 600 dpi  ○ 1200 dpi         │  Scan info:                   │
│                                │  Estimated file: ~2.4 MB      │
│  Mode                          │  Est. time: ~8 s              │
│  ◉ Auto  ○ Color  ○ Greyscale  │                               │
│  ○ Black & White               │                               │
│                                │                               │
│  Format                        │                               │
│  ◉ PDF  ○ JPEG  ○ PNG          │                               │
│  ○ PDF+OCR (slower)            │                               │
│                                │                               │
│  Page size                     │                               │
│  [A4                      ▼]   │                               │
│                                │                               │
│  ┌──────────────────────────┐  │                               │
│  │  🔁 Multi-page           │  │                               │
│  │  ○ Single page           │  │                               │
│  │  ○ ADF automatic         │  │                               │
│  │  ◉ Manual (prompt each)  │  │                               │
│  └──────────────────────────┘  │                               │
│                                │                               │
│  [  📷 Start Scan  ]           │                               │
│                                │                               │
└────────────────────────────────┴────────────────────────────────┘
```

### 9.2 Scan in progress state

```
┌─────────────────────────────────────────────────────────────────┐
│  Scanning...                                                     │
│                                                                  │
│  ████████████████████░░░░░░  78%  Scanning page 1 of 1          │
│                                                                  │
│  ░ Initialising scanner                      ✅ Done             │
│  ░ Scanning (300 dpi, Color, A4)             ⏳ In progress      │
│  ░ Converting to PDF                         ○ Pending          │
│  ░ Saving to /srv/printershare/scans/        ○ Pending          │
│  ░ Uploading to gdrive:Scans/2026-05-07/     ○ Pending          │
│                                                                  │
│  [Cancel]                                                        │
└─────────────────────────────────────────────────────────────────┘
```

Progress is delivered via **WebSocket** from scanservjs (already supports
socket.io). The portal proxies `/ws/scan/` through nginx.

### 9.3 Scan complete state

```
┌─────────────────────────────────────────────────────────────────┐
│  ✅ Scan Complete                                               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │                                                        │    │
│  │              [PDF thumbnail preview]                   │    │
│  │                                                        │    │
│  │    scan_2026-05-07_143201.pdf  ·  1 page  ·  1.8 MB   │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  [⬇ Download]   [📋 Copy link]   [☁ Re-upload]   [🗑 Delete]   │
│                                                                  │
│  Auto-uploaded to: gdrive:Scans/2026-05-07/ ✅                 │
│  Added to Documents library ✅ (OCR in progress...)            │
│                                                                  │
│  [📷 Scan another]                        [📄 View in Docs →] │
└─────────────────────────────────────────────────────────────────┘
```

### 9.4 Recent scans / file browser

Sub-page at `/scan/files`:

```
┌─────────────────────────────────────────────────────────────────┐
│  Recent Scans                    [⬆ Upload file]  [🔍 Search]   │
├─────────────────────────────────────────────────────────────────┤
│  Today — May 7, 2026                                            │
│  ┌──────┐  scan_143201.pdf   A4 · PDF · 1.8 MB                  │
│  │ [pdf]│  14:32:01  ·  300 dpi  ·  Color                       │
│  │      │  [⬇ Download] [👁 Preview] [📋 Copy link] [🗑]         │
│  └──────┘                                                        │
│  ┌──────┐  scan_091034.pdf   A4 · PDF · 3.2 MB                  │
│  │ [pdf]│  09:10:34  ·  300 dpi  ·  Greyscale                   │
│  │      │  [⬇ Download] [👁 Preview] [📋 Copy link] [🗑]         │
│  └──────┘                                                        │
│  Yesterday — May 6, 2026                                        │
│  ┌──────┐  scan_165512.jpg   ...                                 │
│  └──────┘                                                        │
└─────────────────────────────────────────────────────────────────┘
```

**Preview:** PDFs open in a `<iframe>` or PDF.js viewer within the portal. Images
open in a full-screen lightbox overlay.

---

## 10. Print Module

### 10.1 Print queue view

```
┌─────────────────────────────────────────────────────────────────┐
│  Print Queue                     Printer: HP LaserJet M404n ▼   │
│  Status: ● Ready · 0 jobs active                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Print from your device:                                 │   │
│  │                                                          │   │
│  │   iOS / macOS   Android   Windows   Linux                │   │
│  │   ──────────────────────────────────────────             │   │
│  │   Open any document, tap Share → Print.                  │   │
│  │   Printer appears as "PS-LaserJet" automatically.        │   │
│  │                                                          │   │
│  │   No driver, no setup needed. ✅                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  — or —                                                          │
│                                                                  │
│  Upload file to print:                                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │        [  📎 Drop PDF / JPEG / PNG here  ]               │   │
│  │            or [Browse files]                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Copies: [1]  Colour: ◉ Auto  ○ B&W   Duplex: ☑                │
│                                                                  │
│  [🖨 Print]                                                      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Job History (today)                                             │
│                                                                  │
│  ✅  Invoice.pdf          2 pages  14:22  john@phone             │
│  ✅  Report.pdf           8 pages  11:05  macbook-pro            │
│  ❌  Photo.jpg            1 page   09:30  (cancelled)            │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 File upload to print

The portal accepts a PDF/JPEG/PNG upload via a `<form>` multipart POST or
drag-and-drop. The portal backend calls the CUPS `lp` command on the host via
the Docker socket or directly via IPP using `node-ipp`.

**IPP print flow (no Docker socket needed):**
```
portal backend
  → node-ipp: Print-Job to ipp://host.docker.internal:631/printers/<name>
  → CUPS accepts job
  → CUPS sends to ipp-usb
  → ipp-usb sends over USB
  → Printer prints
```

### 10.3 How to print instructions (per platform tab)

Shown as tabbed cards in the Print page — **read-only information**:

#### iOS / macOS tab
```
1. Open your document in any app
2. Tap the Share button (□↑)
3. Tap "Print"
4. Select "PS-LaserJet" from the printer list
5. Tap "Print" — done!

💡 The printer is discovered automatically via AirPrint.
   No app or driver needed.
```

#### Android tab
```
1. Open your document in any app
2. Tap the share / three-dot menu
3. Tap "Print"
4. Ensure "Mopria Print Service" is selected
5. Select "PS-LaserJet" — tap Print

💡 Mopria is built into Android 8+.
```

#### Windows tab
```
1. Open your document (PDF, Word, etc.)
2. File → Print
3. Select "PS-LaserJet (IPP)" from the printer list
   (Windows adds it automatically if on same network)
4. Click Print

💡 Windows 10/11 discovers IPP printers automatically.
```

#### Linux tab
```
$ lpstat -a -h 192.168.1.50         # list printers
$ lp -d PS-LaserJet document.pdf    # print

Or add in GNOME Settings → Printers → Add → Network Printer
```

---

## 11. Document Library

### 11.1 Overview

The Document Library is Paperless-ngx, embedded in the portal via an
`<iframe>` at `/docs/` **or** (preferred for seamless UX) exposed via the
Paperless-ngx REST API and rendered natively within the portal Vue SPA.

**Recommendation: REST API mode** — fetches documents, thumbnails, and search
results from Paperless-ngx API and renders them in the portal's own design
system. The Paperless-ngx frontend is not shown directly; only its API is used.

### 11.2 Document grid view

```
┌─────────────────────────────────────────────────────────────────┐
│  Documents                                                       │
│  [🔍 Search: ________________]  [↕ Date ▼]  [+ Upload]         │
├─────────────────────────────────────────────────────────────────┤
│  Tags:  All ✕  Invoice ✕  [+ Add filter]                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ [thumb]  │ │ [thumb]  │ │ [thumb]  │ │ [thumb]  │           │
│  │ Invoice  │ │ Receipt  │ │ Letter   │ │ Contract │           │
│  │ May 7    │ │ May 5    │ │ May 1    │ │ Apr 28   │           │
│  │ #invoice │ │ #receipt │ │ #letter  │ │ #legal   │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                  │
│  ┌──────────┐ ┌──────────┐  ...                                 │
│  │ [thumb]  │ │ [thumb]  │                                       │
│  └──────────┘ └──────────┘                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 11.3 Document detail panel (slide-in from right)

```
┌──────────────────────────────────────────────────────┐
│  Invoice_May2026.pdf             [⬇] [🖨] [🗑]  [✕]  │
├──────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐  │
│  │                                                │  │
│  │         [PDF viewer — PDF.js]                  │  │
│  │         Page 1 of 3    [◄] [►]                │  │
│  │                                                │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  Title:        [Invoice May 2026          ]           │
│  Date:         [2026-05-07                ]           │
│  Correspondent: [ACME Corp               ]           │
│  Tags:         [invoice] [expenses] [+ Add]           │
│                                                       │
│  OCR Text (excerpt):                                  │
│  ┌────────────────────────────────────────────────┐  │
│  │ "Invoice #1042 — ACME Corp — Total: £450.00..." │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  [Save metadata]                                      │
└──────────────────────────────────────────────────────┘
```

### 11.4 Full-text search UX

```
┌─────────────────────────────────────────────────────────────────┐
│  🔍 [invoice acme               ]  ← as-you-type search          │
│                                                                  │
│  3 results for "invoice acme":                                   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Invoice_May2026.pdf    May 7, 2026    ACME Corp         │    │
│  │  "...Invoice #1042 — **ACME Corp** — Total: £450.00..."  │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Invoice_Apr2026.pdf    Apr 3, 2026    ACME Corp         │    │
│  │  "...Invoice #1041 — **ACME Corp** — Total: £380.00..."  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

Search is debounced at 300 ms. Results show OCR text snippets with keyword
highlighting. Backed by Paperless-ngx's fulltext search API.

---

## 12. Settings Module

### 12.1 Settings navigation

```
Settings
├── Printer
│   ├── Add / remove printers (links to CUPS admin)
│   ├── AirPrint status
│   └── Test print
├── Scanner
│   ├── Device list (from SANE)
│   ├── AirScan / eSCL status
│   └── Test scan
├── Cloud Storage
│   ├── Google Drive (rclone status + reconfigure)
│   ├── OneDrive (rclone status + reconfigure)
│   └── Upload folder pattern (date format)
├── Remote Access
│   ├── Tailscale (status, IP, reconnect)
│   ├── Cloudflare Tunnel (status, URL)
│   └── LAN hostname / IP
├── Sharing
│   ├── Samba (enable/disable, password reset)
│   ├── NFS (enable/disable, allowed subnet)
│   └── Scan folder path
├── Passwords
│   ├── CUPS admin password
│   ├── Samba password
│   └── Portal password (optional)
├── Appearance
│   ├── Dark mode / light mode / system
│   └── Language (i18n)
└── Advanced
    ├── Raw .env editor (code block, with Save + Restart)
    ├── Service restart buttons (individual containers)
    ├── Log viewer (tail docker logs per service)
    └── USB/IP status + bind management
```

### 12.2 Settings page layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings › Cloud Storage                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Google Drive                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Status:    ✅ Connected  (gdrive:Scans/)                 │   │
│  │  Last sync: 2026-05-07 14:32  ·  23 files total           │   │
│  │                                                          │   │
│  │  Upload folder:  Scans/{YYYY}-{MM}-{DD}/                 │   │
│  │                  [Scans/{YYYY}-{MM}-{DD}/        ] [Save] │   │
│  │                                                          │   │
│  │  [Test connection]   [Reconfigure OAuth]   [Disconnect]  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Microsoft OneDrive                                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Status:    ○ Not configured                             │   │
│  │  [Configure OneDrive →]                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 12.3 Log viewer

```
┌─────────────────────────────────────────────────────────────────┐
│  Logs  Service: [CUPS ▼]           [⬇ Download log]  [🗑 Clear] │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ [2026-05-07 14:31:01] CUPS: Job 42 printed successfully  │   │
│  │ [2026-05-07 14:30:58] CUPS: Processing job 42 (PDF, 2pg) │   │
│  │ [2026-05-07 14:30:55] CUPS: Received job from 192.168.1.│   │
│  │ ...                                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ☑ Auto-scroll                                 Lines: [200 ▼]   │
└─────────────────────────────────────────────────────────────────┘
```

Logs are streamed from the portal backend via Server-Sent Events, which calls
`docker logs --follow <container>` and streams output.

---

## 13. Mobile UX

### 13.1 Mobile scan flow (one-hand optimised)

The scan page on mobile collapses the controls panel into a bottom sheet. The
most common settings are front-and-center; advanced options are hidden behind
an "Advanced" expandable.

```
┌─────────────────────┐
│  Scan               │
│                     │
│  ┌───────────────┐  │
│  │  Preview area │  │
│  │  (placeholder)│  │
│  │               │  │
│  └───────────────┘  │
│                     │
│  ╔═════════════════╗│
│  ║  Quick settings ║│
│  ║                 ║│
│  ║ [PDF] [JPG] [PNG]║│
│  ║                 ║│
│  ║ [150] [300][600]║│
│  ║       dpi       ║│
│  ║                 ║│
│  ║ [Auto][Color][BW]║│
│  ║                 ║│
│  ║ [Advanced ▾]   ║│
│  ╚═════════════════╝│
│                     │
│  ┌─────────────────┐│
│  │  📷  Scan Now   ││
│  └─────────────────┘│
└─────────────────────┘
```

### 13.2 Progressive Web App (PWA)

The portal includes a Web App Manifest so users can add it to their home screen:

```json
// portal/public/manifest.json
{
  "name": "printershare",
  "short_name": "printershare",
  "description": "Scan, print and manage documents",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2563EB",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512",
      "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Scan", "url": "/scan", "icons": [{"src": "/icons/scan-96.png"}] },
    { "name": "Documents", "url": "/docs", "icons": [{"src": "/icons/docs-96.png"}] }
  ]
}
```

**What PWA does NOT mean here:** No service worker for offline printing (no
local queue). PWA install is purely for convenience (home screen icon, no
browser chrome, native-feeling transitions). The full server must be reachable
on the LAN or via Tailscale.

### 13.3 AirScan / eSCL (native mobile, no browser needed)

When `ipp-usb` is running, iOS and macOS can scan **without opening the
portal**:

| Platform | Native path |
|---|---|
| iOS 16+ | Files app → Three-dot menu → Scan Document |
| iOS (any) | Notes → Camera button → Scan Documents |
| macOS | Preview → File → Import from Scanner → \<device name\> |
| macOS | Image Capture.app |

These flows bypass the portal entirely and use the eSCL protocol directly.
The portal scan UI is the **fallback** for devices that do not support AirScan
(older Android, Windows, Linux browsers).

---

## 14. Component Library

### 14.1 Button variants

```
[Primary]        Blue bg, white text, hover darken
[Secondary]      White bg, border, hover light blue bg
[Destructive]    Red bg / border, for delete actions
[Ghost]          No bg, no border, text-only, hover bg-neutral-100
[Icon-only]      24px button with icon, tooltip required
[Loading]        Primary + spinner, disabled during async action
```

### 14.2 StatusBadge component

```vue
<!-- Props: status: 'ok' | 'warning' | 'error' | 'pending' | 'offline' -->
<StatusBadge status="ok" label="CUPS" />
<!-- Renders: ● CUPS (green dot + text) -->
```

Used in: dashboard service grid, topbar indicator strip, settings per-service.

### 14.3 ProgressBar component

```vue
<ProgressBar :value="62" :max="100" label="Scanning..." animated />
```

Animated fill transition. Accessible: `role="progressbar"` `aria-valuenow`.

### 14.4 Toast notification system

Pinia store `useToastStore` with:
```typescript
interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  body?: string
  duration?: number   // default 4000ms; 0 = persistent
  action?: { label: string; fn: () => void }
}
```

Example toast triggers:
- Scan complete → `success` "Scan complete" + Download action button
- Upload failed → `error` "Cloud upload failed" + Retry action
- Printer offline → `warning` "Printer offline — check USB connection"
- Service restarted → `info` "CUPS restarted"

### 14.5 Confirmation modal

Used for destructive actions (delete file, disconnect cloud):

```
┌───────────────────────────────────────┐
│  Delete scan_143201.pdf?              │
│                                       │
│  This file will be permanently        │
│  deleted and cannot be recovered.     │
│                                       │
│  [Cancel]          [Delete file]      │
└───────────────────────────────────────┘
```

### 14.6 Empty states

Every list/grid has a thoughtful empty state:

```
Recent Scans — empty:
  ┌────────────────────────────────┐
  │   📷                           │
  │   No scans yet                 │
  │   Tap "Scan Now" to get        │
  │   started.                     │
  │   [Scan Now →]                 │
  └────────────────────────────────┘

Documents — empty:
  ┌────────────────────────────────┐
  │   📄                           │
  │   No documents yet             │
  │   Scanned documents appear     │
  │   here automatically after     │
  │   OCR processing.              │
  └────────────────────────────────┘
```

### 14.7 Accessibility requirements

- All interactive elements keyboard-navigable (Tab, Enter/Space, Escape)
- ARIA roles for dynamic regions: `role="status"` for toast, `role="progressbar"`, `aria-live="polite"` for scan status
- Colour contrast: all text ≥ WCAG AA (4.5:1 normal, 3:1 large)
- Focus rings: visible blue 2px outline on all focused elements
- Screen-reader-visible labels on all icon-only buttons
- Skip-to-content link at page top
- Forms: `<label>` associated with every input; error messages via `aria-describedby`

---

## 15. API Design

### 15.1 Portal backend API

Base URL: `/api/v1/`

```
GET  /api/v1/health               → { services: { cups, scanservjs, … } }
GET  /api/v1/system/info          → { ip, hostname, version, uptime }
GET  /api/v1/usb/devices          → [{ busid, vid, pid, name, classes }]
GET  /api/v1/wizard/state         → { step, completed, config }
POST /api/v1/wizard/state         → { step, data } → { ok, errors }
POST /api/v1/wizard/build         → SSE stream of build log lines
GET  /api/v1/printer/queue        → CUPS IPP job list
POST /api/v1/printer/print        → multipart/form-data file → job id
GET  /api/v1/scans                → [{ name, size, date, path, url }]
GET  /api/v1/scans/:filename      → file download (proxy from /scans/)
DELETE /api/v1/scans/:filename    → 204
GET  /api/v1/settings             → current .env values (passwords redacted)
PATCH /api/v1/settings            → partial update → writes .env → restart affected services
GET  /api/v1/logs/:service        → SSE stream of docker logs --follow
POST /api/v1/services/:name/restart → 202
GET  /api/v1/rclone/remotes       → rclone listremotes
POST /api/v1/rclone/test/:remote  → test connection
```

### 15.2 Authentication (when portal password is set)

The portal uses **HTTP Basic Auth** (simple, browser-native) when
`PORTAL_AUTH_ENABLED=true`. The username is `admin`; the password is set in
the wizard (stored hashed with bcrypt in `portal-data/auth.json`).

All API routes return `401 WWW-Authenticate: Basic realm="printershare"` when
not authenticated.

For Tailscale/remote access, the user's Tailscale identity provides network-
level auth; portal auth can be disabled on the LAN.

### 15.3 WebSocket events (scan progress)

The portal proxies scanservjs socket.io events to the browser on path
`/ws/scan/`. Event schema:

```typescript
// Server → client
interface ScanEvent {
  event: 'scan:progress' | 'scan:complete' | 'scan:error' | 'scan:cancel'
  data: {
    jobId: string
    percent?: number        // 0–100
    stage?: string          // "scanning" | "converting" | "saving" | "uploading"
    filename?: string       // on complete
    error?: string          // on error
  }
}
```

---

## 16. Container Architecture

### 16.1 Full docker-compose service inventory

```
Service          Image                                    Network    Purpose
─────────────────────────────────────────────────────────────────────────────────
nginx            nginx:alpine                             bridge     Reverse proxy / TLS
portal           ./portal  (custom)                      bridge     Vue SPA + API backend
cups             ./cups    (custom)                       HOST       Print server + AirPrint
ipp-usb          ghcr.io/openprinting/ipp-usb             HOST       USB→IPP proxy + AirScan
scanservjs       ./scanservjs  (custom)                   bridge     SANE web scanner UI
samba            dperson/samba                            HOST       SMB/CIFS share
nfs              erichough/nfs-server                     bridge     NFS share
paperless        ghcr.io/paperless-ngx/paperless-ngx      bridge     OCR + document DMS
paperless-db     postgres:16-alpine                       bridge     Paperless database
paperless-redis  redis:7-alpine                           bridge     Paperless task queue
tailscale        tailscale/tailscale                      HOST       WireGuard mesh VPN
cloudflared      cloudflare/cloudflared                   bridge     HTTPS tunnel (optional)
```

### 16.2 Volume inventory

```
Volume                  Mount point                        Purpose
─────────────────────────────────────────────────────────────────────────
cups-config             /etc/cups                          CUPS printer config
cups-ppd                /usr/share/cups/model              PPD files
ipp-usb-state           /var/ipp-usb                       ipp-usb port persistence
ipp-usb-conf            /etc/ipp-usb                       ipp-usb config + quirks
scanservjs-data         /app/data                          scanservjs scans (internal)
scans-host              /srv/printershare/scans            Shared scan output (bind mount)
paperless-data          /usr/src/paperless/data            Paperless index
paperless-media         /usr/src/paperless/media           Archived documents
paperless-db            /var/lib/postgresql/data           Postgres data
paperless-redis         /data                              Redis persistence
portal-data             /app/data                          Wizard state, auth.json
tailscale-state         /var/lib/tailscale                 WireGuard keys
rclone-config           /root/.config/rclone               rclone OAuth tokens
```

### 16.3 Network topology

```
External LAN clients
       │
       │ :80 / :443
       ▼
   ┌──────┐  ← bridge network: ps-network
   │nginx │ ────────────────────────────────────────┐
   └──┬───┘                                         │
      │                                             │
   :3000   :8080    :8000                           │
   ┌───────┐ ┌─────────────┐ ┌───────────────┐     │
   │portal │ │  scanservjs │ │ paperless-ngx │     │
   └───┬───┘ └─────────────┘ └──────┬────────┘     │
       │                             │              │
       │         ┌───────────────────┘              │
       │         │  ┌─────────┐  ┌──────────┐       │
       │         │  │postgres │  │  redis   │       │
       │         │  └─────────┘  └──────────┘       │
       │         │                                  │
       └─────────┴──────────────────────────────────┘
                          │
                    host network:
                    CUPS :631
                    ipp-usb :60000
                    Samba :445
                    Tailscale (VPN)
```

All containers on `ps-network` can resolve each other by service name
(`ps-cups`, `ps-scanservjs`, etc.). CUPS, ipp-usb, Samba, and Tailscale use
`network_mode: host` for mDNS/Bonjour broadcasting.

---

## 17. Persistence & State

### 17.1 What survives a container restart

| Data | Persists? | How |
|---|---|---|
| CUPS printer config (lpadmin queues) | ✅ | `cups-config` volume |
| Scan files | ✅ | `scans-host` bind mount |
| Paperless documents + OCR index | ✅ | `paperless-data` + `paperless-media` volumes |
| Paperless database | ✅ | `paperless-db` volume |
| rclone OAuth tokens | ✅ | `rclone-config` volume |
| Tailscale WireGuard keys | ✅ | `tailscale-state` volume |
| ipp-usb port allocations | ✅ | `ipp-usb-state` volume |
| Portal wizard state | ✅ | `portal-data` volume |
| `.env` settings | ✅ | Host filesystem |
| Active print jobs | ⚠️ | In-flight jobs lost on crash; CUPS re-queues |

### 17.2 Backup strategy

```bash
# Makefile target: make backup
backup: ## Backup all persistent data to ./backups/
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S); \
	mkdir -p backups/$$TIMESTAMP; \
	docker run --rm \
	    -v cups-config:/data/cups-config \
	    -v paperless-data:/data/paperless-data \
	    -v paperless-media:/data/paperless-media \
	    -v rclone-config:/data/rclone-config \
	    -v portal-data:/data/portal-data \
	    -v $(SCANS_DIR):/data/scans \
	    -v $(PWD)/backups/$$TIMESTAMP:/backup \
	    alpine tar czf /backup/printershare-backup.tar.gz /data; \
	echo "Backup saved to backups/$$TIMESTAMP/printershare-backup.tar.gz"
```

---

## 18. Observability

### 18.1 Health check endpoints

Each container has a Docker HEALTHCHECK:

```dockerfile
# All custom containers
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -sf http://localhost:<PORT>/health || exit 1
```

Portal aggregates all service health at `/api/v1/health`:

```json
{
  "status": "degraded",
  "services": {
    "cups":        { "status": "ok",      "latency_ms": 12 },
    "ipp-usb":     { "status": "ok",      "latency_ms": 0  },
    "scanservjs":  { "status": "ok",      "latency_ms": 34 },
    "paperless":   { "status": "ok",      "latency_ms": 87 },
    "samba":       { "status": "warning", "message": "Port 445 conflict" },
    "nfs":         { "status": "ok",      "latency_ms": 5  },
    "tailscale":   { "status": "ok",      "ip": "100.64.12.34" },
    "cloudflare":  { "status": "offline", "message": "Container not running" }
  },
  "devices": {
    "printer": { "status": "ok", "name": "HP LaserJet M404n" },
    "scanner": { "status": "ok", "name": "Canon LiDE 300" }
  }
}
```

### 18.2 Log aggregation (optional)

For users who want centralised logs, add a `Loki + Grafana` profile:

```yaml
# docker-compose.override.yml (opt-in, not default)
loki:
  image: grafana/loki:latest
  ...
grafana:
  image: grafana/grafana:latest
  ports: ["3100:3000"]
  ...
```

Not included in default stack. Activated via `docker compose --profile monitoring up`.

---

## 19. Security Architecture

### 19.1 Threat model

The printershare stack runs on a home/office LAN and is accessed by trusted
users. The primary threat vectors are:

| Threat | Mitigation |
|---|---|
| Weak default passwords | Wizard enforces strong passwords; `.env.example` ships with `CHANGEME` placeholders, not real passwords |
| Exposed CUPS admin to full LAN | Rate-limiting via nginx `limit_req`; CUPS admin requires HTTP Basic Auth |
| Samba password in compose args (visible in `ps aux`) | Use Docker secrets or tmpfs credential files |
| NFS wildcard export | Default to `192.168.0.0/16`; wizard detects LAN subnet and pre-fills |
| `privileged: true` containers | Replace with `device_cgroup_rules` + targeted `cap_add` |
| Scan files accessible without auth | Portal auth covers `/api/v1/scans/`; physical scan dir accessible only via Samba (credentialed) |
| Remote access tokens in `.env` | `.gitignore` covers `.env`; Tailscale auth keys are one-time use |
| XSS in document filenames | All filename rendering uses `textContent`, not `innerHTML` |
| CSRF | Same-origin SPA with no form submissions across origins; SameSite cookies |
| Path traversal in file downloads | Portal backend validates filenames against `path.basename()` and checks against allowed scan dir |

### 19.2 TLS configuration

Production deployments should use TLS. The wizard offers:

**Option A — Self-signed (LAN only, generated at setup):**
```bash
openssl req -x509 -nodes -newkey rsa:4096 \
  -keyout /srv/printershare/tls/key.pem \
  -out /srv/printershare/tls/cert.pem \
  -days 3650 \
  -subj "/CN=printershare.local" \
  -addext "subjectAltName=IP:${SERVER_IP},DNS:printershare.local"
```

**Option B — Let's Encrypt (requires public DNS + port 80 forwarding):**
```yaml
certbot:
  image: certbot/certbot
  volumes:
    - letsencrypt:/etc/letsencrypt
    - ./nginx/certbot-webroot:/var/www/certbot
  command: >-
    certonly --webroot
    -w /var/www/certbot
    -d ${DOMAIN_NAME}
    --email ${ADMIN_EMAIL}
    --agree-tos --non-interactive
```

**nginx HTTPS config:**
```nginx
server {
    listen 443 ssl http2;
    ssl_certificate     /etc/tls/cert.pem;
    ssl_certificate_key /etc/tls/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    add_header          Strict-Transport-Security "max-age=63072000" always;
    add_header          X-Frame-Options SAMEORIGIN;
    add_header          X-Content-Type-Options nosniff;
    add_header          Referrer-Policy strict-origin-when-cross-origin;
    ...
}
```

---

## 20. Implementation Roadmap

### Phase 1 — Portal scaffold (Week 1–2)
- [ ] Create `portal/` directory with Vite + Vue 3 + TypeScript + Pinia
- [ ] Implement AppShell: sidebar, topbar, bottom nav (mobile)
- [ ] Wire up vue-router with placeholder views for all routes
- [ ] Implement design tokens (CSS custom properties), Button, Card, StatusBadge, Toast components
- [ ] Add Docker service `portal` to `docker-compose.yml`
- [ ] Wire nginx routes: `/` → portal, `/scan/` → scanservjs, `/docs/` → paperless, `/cups/` → CUPS
- [ ] Portal backend: `/api/v1/health` polling all services

### Phase 2 — AirPrint / ipp-usb / AirScan (Week 2–3)
- [ ] Add `ipp-usb` service to `docker-compose.yml`
- [ ] Add `sane-airscan` to scanservjs Dockerfile
- [ ] Update CUPS entrypoint with `everywhere` driver registration
- [ ] Test: AirPrint from iPhone, Mopria from Android, AirScan from macOS Preview
- [ ] Dashboard: printer + scanner status cards showing AirPrint/AirScan state

### Phase 3 — Wizard (Week 3–5)
- [ ] Implement all 7 wizard steps (Vue components + portal backend state machine)
- [ ] USB detection API (`lsusb` parser + known-device JSON database)
- [ ] Password validation (strength meter, confirm field)
- [ ] rclone OAuth flow integration (spawns rclone config, polls for completion)
- [ ] Build progress SSE stream (`docker compose up` output forwarded to browser)
- [ ] Post-build health check + success screen with test print/scan buttons

### Phase 4 — Scan module (Week 5–6)
- [ ] ScanControls.vue with all options
- [ ] ScanProgress.vue with WebSocket progress
- [ ] ScanPreview.vue with PDF.js / image lightbox
- [ ] FileList.vue with grouping by date, download, preview, delete
- [ ] Portal backend: `/api/v1/scans` endpoints
- [ ] Mobile-optimised layout (bottom sheet controls)

### Phase 5 — Document Library (Week 6–7)
- [ ] Add Paperless-ngx + Postgres + Redis to `docker-compose.yml`
- [ ] Implement document grid + search via Paperless REST API
- [ ] Document detail slide-in panel with PDF.js viewer
- [ ] Metadata editing (tags, title, correspondent)
- [ ] nginx `/docs/` proxy

### Phase 6 — Print module + cloud + remote access (Week 7–8)
- [ ] Print queue view (CUPS IPP queries via portal backend)
- [ ] File upload to print (multipart → IPP)
- [ ] Per-platform print instructions (tabbed card)
- [ ] Tailscale service in docker-compose + wizard step
- [ ] Cloudflare Tunnel service + wizard step
- [ ] Settings › Cloud Storage (rclone status + reconfigure)
- [ ] Settings › Remote Access

### Phase 7 — USB hotplug + Security (Week 8–9)
- [ ] udev rules for auto-rebind (`usbip/udev/`)
- [ ] Update `install-usbip-server.sh` with udev install
- [ ] NFS export subnet fix
- [ ] Drop `privileged: true` → `device_cgroup_rules`
- [ ] Docker secrets for Samba password
- [ ] TLS wizard step (self-signed or Let's Encrypt)
- [ ] Portal auth (bcrypt, HTTP Basic)

### Phase 8 — Polish & PWA (Week 9–10)
- [ ] PWA manifest + icons
- [ ] Dark mode
- [ ] i18n scaffolding (English default; French, German, Spanish stubs)
- [ ] Accessibility audit (keyboard nav, ARIA, contrast)
- [ ] `make backup` target
- [ ] Full README update with new portal screenshots
- [ ] End-to-end tests (Playwright): wizard → scan → find in docs → print

---

## Appendix A — Comparison: current vs. target UX

| Task | Current (today) | Target (post-implementation) |
|---|---|---|
| First-time setup | Edit `.env` manually, read README | Browser wizard, step-by-step, 5 minutes |
| Scan a document | Open port 8080 URL | Open `/` portal, click Scan |
| Find a scan from last week | SSH to server or mount Samba | `/docs` search by OCR text |
| Print from iPhone | App-specific share → AirPrint (may fail) | Tap Print in any app → works first time |
| Print from browser | Not possible | Drag PDF to print page → done |
| Check if printer is online | Unknown | Dashboard status card |
| Change Samba password | Edit `.env`, restart container | Settings › Passwords |
| Add Google Drive | Run `make setup-rclone` in terminal | Settings › Cloud Storage → Connect |
| Access from outside LAN | Not possible | Tailscale (wizard step) |
| Read text from a scanned invoice | Not possible | Documents library, full-text search |

## Appendix B — Technology choices rationale

| Choice | Alternative considered | Reason |
|---|---|---|
| Vue 3 + Vite | React, Svelte | Vue's SFC model maps cleanly to component library structure; Vite is fastest for small-to-medium SPAs; no build tooling expertise assumed |
| Pinia | Vuex, Zustand | Official Vue state management, simpler API, TypeScript-native |
| Tailwind CSS | CSS Modules, styled-components | Utility-first is fastest for wizard + dashboard work; no CSS naming decisions |
| node-ipp | Raw HTTP IPP | Type-safe IPP attribute handling; avoids `lp` command injection |
| PDF.js | Native iframe | Consistent cross-browser rendering; sandboxed; no server-side PDF-to-image needed |
| whiptail (fallback wizard) | Python Textual, Gum | Zero extra runtime dependency on Ubuntu 22.04 |
| Server-Sent Events for logs | WebSocket | SSE is simpler for one-way server→client streams; no ws library needed |
| Paperless-ngx REST API (not iframe) | iframe embed | Seamless UI; portal design system wraps the data; avoids CSP/cookie issues |

---

*Spec version 2.0 — May 2026*
