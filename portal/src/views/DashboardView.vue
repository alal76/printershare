<!-- Beta test version v1.2.0 -->
<template>
  <AppShell title="Dashboard">
    <Card
      v-if="system.wizardCompleted === false"
      class="mb-6"
    >
      <div class="flex items-start gap-3">
        <AlertCircleIcon class="w-5 h-5 text-amber-500 mt-0.5" />
        <div class="flex-1">
          <p class="text-sm font-semibold text-gray-900">
            Initial setup not completed
          </p>
          <p class="text-sm text-gray-500 mt-1">
            You can use the dashboard immediately, then run the setup wizard when ready.
          </p>
        </div>
        <Button
          size="sm"
          @click="$router.push('/wizard')"
        >
          Run Wizard
        </Button>
      </div>
    </Card>

    <!-- ── Status bar ───────────────────────────────────────────────────── -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-1"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">{{ stat.label }}</span>
          <div
            class="w-7 h-7 rounded-lg flex items-center justify-center"
            :class="stat.bg"
          >
            <component
              :is="stat.icon"
              class="w-3.5 h-3.5"
              :class="stat.color"
            />
          </div>
        </div>
        <p class="text-xl font-bold text-gray-900">
          {{ stat.value }}
        </p>
        <p
          class="text-xs"
          :class="stat.subColor"
        >
          {{ stat.sub }}
        </p>
      </div>
    </div>

    <!-- ── Service health grid ──────────────────────────────────────────── -->
    <section class="mb-6">
      <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Services
      </h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <template v-if="system.health">
          <div
            v-for="(svc, name) in system.health.services"
            :key="name"
            :data-testid="`service-${name}`"
            class="bg-white rounded-2xl border p-4 flex items-center gap-3 transition-colors"
            :class="svc.status === 'ok' ? 'border-green-100' : svc.status === 'error' ? 'border-red-100' : 'border-gray-100'"
          >
            <div
              class="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              :class="statusBg(svc.status)"
            >
              <component
                :is="serviceIcon(String(name))"
                class="w-4 h-4"
                :class="statusColor(svc.status)"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-semibold text-gray-800 capitalize truncate">
                {{ name }}
              </p>
              <p class="text-xs text-gray-400 truncate">
                {{ svc.message || svc.status }}
              </p>
            </div>
          </div>
        </template>
        <template v-else>
          <div
            v-for="i in 6"
            :key="i"
            class="bg-white rounded-2xl border border-gray-100 p-4 h-16 animate-pulse"
          ></div>
        </template>
      </div>
    </section>

    <!-- ── Quick actions ────────────────────────────────────────────────── -->
    <section class="mb-6">
      <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Quick Actions
      </h2>
      <div class="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          @click="$router.push('/wizard')"
        >
          <Settings2Icon class="w-4 h-4" />
          Run Setup Wizard
        </Button>
        <Button @click="$router.push('/scan')">
          <ScanIcon class="w-4 h-4" />
          New Scan
        </Button>
        <Button
          variant="secondary"
          @click="$router.push('/print')"
        >
          <PrinterIcon class="w-4 h-4" />
          Print File
        </Button>
        <Button
          variant="secondary"
          @click="$router.push('/devices')"
        >
          <UsbIcon class="w-4 h-4" />
          Manage Devices
        </Button>
        <Button
          variant="secondary"
          @click="$router.push('/sharing')"
        >
          <ShareIcon class="w-4 h-4" />
          Connection Info
        </Button>
      </div>
    </section>

    <!-- ── System metrics ───────────────────────────────────────────────── -->
    <section class="mb-6 grid md:grid-cols-2 gap-3">
      <Card>
        <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          System Metrics
        </h2>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between gap-3">
            <span class="text-gray-500">Host</span>
            <span class="font-medium text-gray-900 truncate">{{ systemInfo.hostname || 'Unknown' }}</span>
          </div>
          <div class="flex justify-between gap-3">
            <span class="text-gray-500">IP</span>
            <span class="font-medium text-gray-900">{{ systemInfo.ip || 'Unknown' }}</span>
          </div>
          <div class="flex justify-between gap-3">
            <span class="text-gray-500">Platform</span>
            <span class="font-medium text-gray-900">{{ systemInfo.platform || 'Unknown' }}</span>
          </div>
          <div class="flex justify-between gap-3">
            <span class="text-gray-500">Uptime</span>
            <span class="font-medium text-gray-900">{{ uptimeLabel }}</span>
          </div>
        </div>
      </Card>

      <Card>
        <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Key Settings
        </h2>
        <div class="space-y-2 text-sm">
          <div
            v-for="entry in keySettings"
            :key="entry.key"
            class="flex justify-between gap-3"
          >
            <span class="text-gray-500">{{ entry.label }}</span>
            <span class="font-medium text-gray-900 truncate">{{ entry.value }}</span>
          </div>
        </div>
      </Card>
    </section>

    <!-- ── Device inventory ─────────────────────────────────────────────── -->
    <section class="mb-6 grid lg:grid-cols-2 gap-3">
      <Card>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Printers
          </h2>
          <Button
            variant="ghost"
            size="sm"
            @click="$router.push('/devices')"
          >
            Manage
          </Button>
        </div>
        <div
          v-if="devices.printers.length === 0"
          class="text-sm text-gray-500"
        >
          No printers detected.
        </div>
        <div
          v-else
          class="space-y-2"
        >
          <div
            v-for="printer in devices.printers"
            :key="printer.name"
            class="p-2 rounded-xl border border-gray-100"
          >
            <p class="text-sm font-medium text-gray-900 truncate">
              {{ printer.name }}
            </p>
            <p class="text-xs text-gray-500 truncate">
              {{ printer.uri }}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Scanners / USB Devices
        </h2>
        <div
          v-if="devices.usb.length === 0"
          class="text-sm text-gray-500"
        >
          No USB scanner/printer devices detected.
        </div>
        <div
          v-else
          class="space-y-2"
        >
          <div
            v-for="usb in devices.usb"
            :key="usb.vidpid"
            class="p-2 rounded-xl border border-gray-100"
          >
            <p class="text-sm font-medium text-gray-900 truncate">
              {{ usb.name }}
            </p>
            <p class="text-xs text-gray-500">
              {{ usb.vidpid }}
            </p>
          </div>
        </div>
      </Card>
    </section>

    <!-- ── Recent scans ──────────────────────────────────────────────────── -->
    <section>
      <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Recent Scans
      </h2>
      <FileList :max="5" />
    </section>

    <!-- ── Active jobs (print + scan) ───────────────────────────────────── -->
    <section class="mt-6">
      <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Active Jobs
      </h2>
      <Card data-testid="active-jobs-card">
        <div class="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p class="text-gray-500 mb-1">
              Print queue
            </p>
            <p class="text-xl font-bold text-gray-900">
              {{ jobs?.print.count ?? 0 }}
              <span class="text-xs font-normal text-gray-400 ml-1">active</span>
            </p>
            <ul
              v-if="(jobs?.print.jobs.length ?? 0) > 0"
              class="mt-2 space-y-1 text-xs text-gray-600"
            >
              <li
                v-for="j in jobs?.print.jobs.slice(0, 5)"
                :key="j.id"
                class="truncate"
              >
                {{ j.name }} — {{ j.state }}
              </li>
            </ul>
          </div>
          <div>
            <p class="text-gray-500 mb-1">
              Scan activity
            </p>
            <p class="text-xl font-bold text-gray-900">
              {{ jobs?.scan.active ?? 0 }}
              <span
                v-if="(jobs?.scan.queued ?? 0) > 0"
                class="text-xs font-normal text-amber-600 ml-1"
              >+{{ jobs?.scan.queued }} queued</span>
              <span
                v-else
                class="text-xs font-normal text-gray-400 ml-1"
              >active</span>
            </p>
            <p class="text-xs text-gray-500 mt-2">
              Completed: {{ jobs?.scan.completed ?? 0 }}<span
                v-if="jobs?.scan.lastDurationMs"
              > · last {{ Math.round((jobs.scan.lastDurationMs) / 100) / 10 }}s</span>
            </p>
          </div>
        </div>
      </Card>
    </section>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ScanIcon, PrinterIcon, UsbIcon, ShareIcon,
  CheckCircleIcon, AlertCircleIcon, PrinterIcon as PrintIcon,
  FileTextIcon, DatabaseIcon, WifiIcon, ShieldIcon, Settings2Icon,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import AppShell   from '@/components/layout/AppShell.vue'
import Button     from '@/components/ui/Button.vue'
import Card       from '@/components/ui/Card.vue'
import FileList   from '@/components/scan/FileList.vue'
import { useSystemStore } from '@/stores/system'
import { useScanStore }   from '@/stores/scan'
import { usePrintStore }  from '@/stores/print'
import { useDevicesStore } from '@/stores/devices'
import { useApi }         from '@/composables/useApi'

interface JobsSnapshot {
  print: { jobs: Array<{ id: string; name: string; state: string }>; count: number }
  scan:  { active: number; queued: number; completed: number; lastDurationMs: number; lastStartedAt: string | null; lastFinishedAt: string | null }
}

const system = useSystemStore()
const scan   = useScanStore()
const print  = usePrintStore()
const devices = useDevicesStore()
const jobsApi = useApi<JobsSnapshot>()
const jobs = ref<JobsSnapshot | null>(null)
let jobsTimer: ReturnType<typeof setInterval> | null = null
let deviceTimer: ReturnType<typeof setInterval> | null = null

async function refreshJobs() {
  try {
    const data = await jobsApi.call('/api/v1/jobs', { silent: true })
    if (data) jobs.value = data
  } catch { /* ignore — surfaced via service health */ }
}

async function refreshDevicesAndPrinter() {
  await Promise.all([
    devices.fetchDevices(),
    print.fetchQueue(),
  ])
}

const systemInfo = computed(() => {
  const raw = system.info
  return {
    hostname: raw?.hostname ?? '',
    ip: raw?.ip ?? '',
    platform: raw?.platform && raw?.arch ? `${raw.platform}/${raw.arch}` : '',
    uptime: raw?.uptime ?? 0,
  }
})

onMounted(async () => {
  system.startPolling()
  await Promise.all([
    system.ensureWizardChecked(),
    system.fetchInfo(),
    system.fetchSettingsSnapshot(),
    scan.fetchFiles(),
    print.fetchQueue(),
    devices.fetchDevices(),
    refreshJobs(),
  ])
  jobsTimer   = setInterval(refreshJobs, 5_000)
  deviceTimer = setInterval(refreshDevicesAndPrinter, 30_000)
})
onUnmounted(() => {
  system.stopPolling()
  if (jobsTimer)   clearInterval(jobsTimer)
  if (deviceTimer) clearInterval(deviceTimer)
})

const uptimeLabel = computed(() => {
  const secs = Number(systemInfo.value.uptime || 0)
  if (!secs) return 'Unknown'
  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
})

const keySettings = computed(() => {
  const s = system.settingsSnapshot
  return [
    { key: 'NGINX_HTTP_PORT', label: 'HTTP Port', value: s?.NGINX_HTTP_PORT ?? '80' },
    { key: 'NGINX_HTTPS_PORT', label: 'HTTPS Port', value: s?.NGINX_HTTPS_PORT ?? '443' },
    { key: 'CUPS_HOST', label: 'CUPS Host', value: s?.CUPS_HOST ?? 'host.docker.internal' },
    { key: 'CUPS_PORT', label: 'CUPS Port', value: s?.CUPS_PORT ?? '631' },
    { key: 'SCANS_HOST_PATH', label: 'Scans Path', value: s?.SCANS_HOST_PATH ?? '/srv/printershare/scans' },
  ]
})

const healthyCount = computed(() => {
  if (!system.health) return 0
  return Object.values(system.health.services).filter(s => s.status === 'ok').length
})
const totalCount = computed(() => Object.keys(system.health?.services ?? {}).length)

const stats = computed(() => [
  {
    label: 'Services',
    value: `${healthyCount.value}/${totalCount.value}`,
    sub:   healthyCount.value === totalCount.value && totalCount.value > 0 ? 'All healthy' : 'Check status',
    subColor: healthyCount.value === totalCount.value && totalCount.value > 0 ? 'text-green-600' : 'text-amber-600',
    icon:  CheckCircleIcon,
    bg:    'bg-green-50',
    color: 'text-green-600',
  },
  {
    label: 'Scan Files',
    value: String(scan.files.length),
    sub:   'On this device',
    subColor: 'text-gray-400',
    icon:  ScanIcon,
    bg:    'bg-blue-50',
    color: 'text-blue-600',
  },
  {
    label: 'Print Queue',
    value: String(print.jobs.length),
    sub:   print.printerState === 'ok' ? 'Printer ready' : 'Printer offline',
    subColor: print.printerState === 'ok' ? 'text-green-600' : 'text-red-500',
    icon:  PrinterIcon,
    bg:    'bg-purple-50',
    color: 'text-purple-600',
  },
  {
    label: 'Errors',
    value: String(Object.values(system.health?.services ?? {}).filter(s => s.status === 'error').length),
    sub:   'Requires attention',
    subColor: 'text-gray-400',
    icon:  AlertCircleIcon,
    bg:    'bg-red-50',
    color: 'text-red-500',
  },
])

const SERVICE_ICONS: Record<string, Component> = {
  cups:       PrintIcon,
  'ipp-usb':  UsbIcon,
  scanservjs: ScanIcon,
  samba:      ShareIcon,
  nfs:        DatabaseIcon,
  nginx:      WifiIcon,
  paperless:  FileTextIcon,
  tailscale:  ShieldIcon,
  cloudflared: ShieldIcon,
}

function serviceIcon(name: string): Component {
  return SERVICE_ICONS[name] ?? CheckCircleIcon
}

function statusBg(s: string) {
  if (s === 'ok')    return 'bg-green-50'
  if (s === 'error') return 'bg-red-50'
  return 'bg-gray-100'
}
function statusColor(s: string) {
  if (s === 'ok')    return 'text-green-600'
  if (s === 'error') return 'text-red-500'
  return 'text-gray-400'
}
</script>
