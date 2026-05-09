<template>
  <AppShell title="Sharing">
    <div class="max-w-3xl space-y-6">
      <p class="text-sm text-gray-500">
        Connect to shared folders and printers from any device on your network.
      </p>

      <!-- ── File Sharing (Samba) ─────────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 mb-5">
          <div class="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
            <FolderIcon class="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-gray-900">
              File Sharing (Samba / SMB)
            </h2>
            <p class="text-xs text-gray-500">
              Scanned documents are shared over your LAN
            </p>
          </div>
          <StatusBadge
            class="ml-auto"
            :status="sambaStatus"
            :label="sambaLabel"
          />
        </div>

        <!-- Per-platform connection strings -->
        <div class="space-y-3">
          <div
            v-for="p in sambaConnections"
            :key="p.label"
            class="flex items-center gap-3 p-3 rounded-xl bg-gray-50"
          >
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="p.bg"
            >
              <component
                :is="p.icon"
                class="w-4 h-4"
                :class="p.color"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-gray-700">
                {{ p.label }}
              </p>
              <p class="font-mono text-xs text-gray-500 truncate mt-0.5">
                {{ p.path }}
              </p>
            </div>
            <button
              type="button"
              class="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors flex-shrink-0"
              :title="`Copy ${p.label} path`"
              :aria-label="`Copy ${p.label} path`"
              @click="copy(p.path, p.label)"
            >
              <CopyIcon class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- macOS Finder shortcut -->
        <div class="mt-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-700">
          <p class="font-semibold mb-1">
            Quick Connect on macOS
          </p>
          <p>In Finder, press <kbd class="bg-blue-100 px-1 rounded">⌘ K</kbd> and paste the macOS path above.</p>
        </div>
      </Card>

      <!-- ── NFS Sharing ─────────────────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 mb-5">
          <div class="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center flex-shrink-0">
            <ServerIcon class="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-gray-900">
              NFS Export
            </h2>
            <p class="text-xs text-gray-500">
              For Linux and macOS power users
            </p>
          </div>
        </div>

        <div class="space-y-3">
          <div
            v-for="n in nfsConnections"
            :key="n.label"
            class="flex items-center gap-3 p-3 rounded-xl bg-gray-50"
          >
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="n.bg"
            >
              <component
                :is="n.icon"
                class="w-4 h-4"
                :class="n.color"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-gray-700">
                {{ n.label }}
              </p>
              <p class="font-mono text-xs text-gray-500 truncate mt-0.5">
                {{ n.cmd }}
              </p>
            </div>
            <button
              type="button"
              class="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors flex-shrink-0"
              :title="`Copy ${n.label} command`"
              :aria-label="`Copy ${n.label} command`"
              @click="copy(n.cmd, n.label)"
            >
              <CopyIcon class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Card>

      <!-- ── Network Printing ──────────────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 mb-5">
          <div class="w-9 h-9 rounded-xl bg-green-600 flex items-center justify-center flex-shrink-0">
            <PrinterIcon class="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-gray-900">
              Network Printing
            </h2>
            <p class="text-xs text-gray-500">
              AirPrint / Mopria / IPP Everywhere
            </p>
          </div>
        </div>

        <div class="space-y-4">
          <div
            v-for="tp in printingSteps"
            :key="tp.platform"
            class="border border-gray-100 rounded-xl overflow-hidden"
          >
            <button
              type="button"
              class="flex items-center gap-3 w-full p-3 text-left hover:bg-gray-50 transition-colors"
              @click="expandedPlatform = expandedPlatform === tp.platform ? null : tp.platform"
            >
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                :class="tp.bg"
              >
                <component
                  :is="tp.icon"
                  class="w-3.5 h-3.5"
                  :class="tp.color"
                />
              </div>
              <span class="text-sm font-medium text-gray-800 flex-1">{{ tp.platform }}</span>
              <ChevronDownIcon
                class="w-4 h-4 text-gray-400 transition-transform"
                :class="expandedPlatform === tp.platform ? 'rotate-180' : ''"
              />
            </button>
            <div
              v-if="expandedPlatform === tp.platform"
              class="px-4 pb-4 text-xs text-gray-600 space-y-1.5"
            >
              <div
                v-for="(step, i) in tp.steps"
                :key="i"
                class="flex gap-2"
              >
                <span class="w-4 h-4 rounded-full bg-primary-100 text-primary-700 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold">{{ i + 1 }}</span>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <p v-html="step"></p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <!-- ── Remote Access ──────────────────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center flex-shrink-0">
            <GlobeIcon class="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-gray-900">
              Remote Access
            </h2>
            <p class="text-xs text-gray-500">
              Access this portal from anywhere
            </p>
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div class="p-3 rounded-xl bg-gray-50">
            <div class="flex items-center gap-2 mb-1.5">
              <div class="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center">
                <ShieldIcon class="w-3 h-3 text-white" />
              </div>
              <p class="text-xs font-semibold text-gray-800">
                Tailscale VPN
              </p>
              <StatusBadge
                v-if="tailscaleEnabled"
                class="ml-auto"
                :status="tailscaleStatus"
                :label="tailscaleLabel"
              />
            </div>
            <p class="text-xs text-gray-500">
              Connect via Tailscale to access this portal and all shares securely from anywhere in the world.
            </p>
            <p
              v-if="tailscaleIp"
              class="mt-1.5 font-mono text-xs text-indigo-700 bg-indigo-50 rounded px-2 py-1"
            >
              {{ tailscaleIp }}
            </p>
          </div>
          <div class="p-3 rounded-xl bg-gray-50">
            <div class="flex items-center gap-2 mb-1.5">
              <div class="w-6 h-6 rounded bg-orange-500 flex items-center justify-center">
                <CloudIcon class="w-3 h-3 text-white" />
              </div>
              <p class="text-xs font-semibold text-gray-800">
                Cloudflare Tunnel
              </p>
            </div>
            <p class="text-xs text-gray-500">
              The portal is published via Cloudflare Tunnel — access it at your configured domain without port-forwarding.
            </p>
          </div>
        </div>
      </Card>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  FolderIcon, ServerIcon, PrinterIcon, CopyIcon, GlobeIcon,
  ShieldIcon, CloudIcon, ChevronDownIcon,
  AppleIcon, MonitorIcon, SmartphoneIcon, TerminalIcon,
} from 'lucide-vue-next'
import AppShell   from '@/components/layout/AppShell.vue'
import Card       from '@/components/ui/Card.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useSystemStore } from '@/stores/system'
import { useToastStore }  from '@/stores/toast'

const system = useSystemStore()
const toast  = useToastStore()

const expandedPlatform = ref<string | null>('macOS / iOS')

// ── Samba status derived from health ─────────────────────────────────────────
const sambaStatus = computed(() => {
  const s = system.health?.services?.samba?.status
  if (s === 'ok')    return 'ok'     as const
  if (s === 'error') return 'error'  as const
  return 'unknown' as const
})
const sambaLabel = computed(() => sambaStatus.value === 'ok' ? 'Running' : 'Unknown')

// ── Tailscale status derived from health ─────────────────────────────────────
const tailscaleService = computed(() => system.health?.services?.tailscale)
const tailscaleEnabled  = computed(() => tailscaleService.value?.status !== 'disabled')
const tailscaleStatus = computed(() => {
  const s = tailscaleService.value?.status
  if (s === 'ok')      return 'ok'      as const
  if (s === 'offline') return 'error'   as const
  return 'unknown' as const
})
const tailscaleLabel = computed(() => {
  const s = tailscaleService.value?.status
  if (s === 'ok')      return 'Connected'
  if (s === 'offline') return 'Offline'
  return 'Disabled'
})
const tailscaleIp    = computed(() => tailscaleService.value?.ip ?? null)

// ── Hostname (falls back to window.location.hostname) ────────────────────────
const host = computed(() => globalThis.location?.hostname ?? 'printershare.local')

// ── Samba connection paths ────────────────────────────────────────────────────
const sambaConnections = computed(() => [
  {
    label: 'macOS / Linux',
    path:  `smb://${host.value}/scans`,
    icon:  AppleIcon,
    bg:    'bg-gray-100',
    color: 'text-gray-700',
  },
  {
    label: 'Windows',
    path:  `\\\\${host.value}\\scans`,
    icon:  MonitorIcon,
    bg:    'bg-blue-100',
    color: 'text-blue-700',
  },
  {
    label: 'Android (ES File Explorer)',
    path:  `smb://${host.value}/scans`,
    icon:  SmartphoneIcon,
    bg:    'bg-green-100',
    color: 'text-green-700',
  },
])

// ── NFS mount commands ────────────────────────────────────────────────────────
const nfsConnections = computed(() => [
  {
    label: 'Linux mount',
    cmd:   `mount -t nfs ${host.value}:/exports/scans /mnt/scans`,
    icon:  TerminalIcon,
    bg:    'bg-orange-100',
    color: 'text-orange-700',
  },
  {
    label: 'macOS mount',
    cmd:   `mount -o resvport -t nfs ${host.value}:/exports/scans /Volumes/scans`,
    icon:  AppleIcon,
    bg:    'bg-gray-100',
    color: 'text-gray-700',
  },
  {
    label: 'fstab entry',
    cmd:   `${host.value}:/exports/scans /mnt/scans nfs defaults 0 0`,
    icon:  TerminalIcon,
    bg:    'bg-orange-100',
    color: 'text-orange-700',
  },
])

// ── Platform print setup steps ────────────────────────────────────────────────
const printingSteps = [
  {
    platform: 'macOS / iOS',
    icon:     AppleIcon,
    bg:       'bg-gray-100',
    color:    'text-gray-800',
    steps: [
      'Open <b>System Settings → Printers & Scanners</b>',
      'Click <b>Add Printer, Scanner or Fax…</b>',
      'Your printer appears automatically — select it and click <b>Add</b>',
      '<b>iOS:</b> Tap Print in the share sheet — AirPrint discovers it automatically',
    ],
  },
  {
    platform: 'Windows 10 / 11',
    icon:     MonitorIcon,
    bg:       'bg-blue-100',
    color:    'text-blue-700',
    steps: [
      'Open <b>Settings → Bluetooth & devices → Printers & scanners</b>',
      'Click <b>Add device</b> — Windows discovers the IPP printer automatically',
      'If not found, click <b>Add manually</b> and enter<br><code>http://[host]:631/printers/USB-Printer</code>',
    ],
  },
  {
    platform: 'Android',
    icon:     SmartphoneIcon,
    bg:       'bg-green-100',
    color:    'text-green-700',
    steps: [
      'Install <b>Mopria Print Service</b> from the Play Store',
      'Open any app, tap Share → Print',
      'Your printer appears in the printer list — tap to select and print',
    ],
  },
  {
    platform: 'Linux',
    icon:     TerminalIcon,
    bg:       'bg-orange-100',
    color:    'text-orange-700',
    steps: [
      'Install CUPS: <code>sudo apt install cups</code>',
      `Add the printer: <code>sudo lpadmin -p MyPrinter -E -v ipp://${host.value}:631/printers/USB-Printer -m everywhere</code>`,
      'Set as default: <code>lpoptions -d MyPrinter</code>',
      'Test: <code>lp -d MyPrinter /etc/issue</code>',
    ],
  },
]

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied!', `${label} path copied to clipboard`)
  } catch {
    toast.error('Copy failed', 'Your browser did not allow clipboard access')
  }
}
</script>
