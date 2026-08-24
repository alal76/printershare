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
        class="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-1 transition-shadow"
        :class="stat.onClick ? 'cursor-pointer hover:shadow-sm hover:border-gray-200' : ''"
        @click="stat.onClick?.()"
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
            v-for="([name, svc]) in enabledServices"
            :key="name"
            :data-testid="`service-${name}`"
            class="bg-white rounded-2xl border p-3 flex flex-col gap-2 transition-colors"
            :class="svc.status === 'ok' ? 'border-green-100' : svc.status === 'error' ? 'border-red-100' : 'border-gray-100'"
          >
            <!-- top row: icon + name + status -->
            <div class="flex items-center gap-2.5">
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                :class="statusBg(svc.status)"
              >
                <component
                  :is="serviceIcon(String(name))"
                  class="w-3.5 h-3.5"
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
            <!-- Capabilities summary -->
            <div class="text-xs text-gray-500 mt-1">
              {{ serviceCapability(name) }}
            </div>
            <!-- bottom row: restart + toggle -->
            <div class="flex items-center gap-1.5 pt-0.5 border-t border-gray-50">
              <button
                type="button"
                title="Restart"
                class="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                :disabled="!!acting[String(name)] || svc.status === 'offline' || svc.status === 'error'"
                @click="svcAction(String(name), 'restart')"
              >
                <RotateCcwIcon
                  class="w-3 h-3"
                  :class="acting[String(name)] === 'restart' ? 'animate-spin' : ''"
                />
                Restart
              </button>
              <div class="w-px h-4 bg-gray-100"></div>
              <button
                type="button"
                :title="svc.status === 'ok' ? 'Stop service' : 'Start service'"
                class="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-xs transition-colors disabled:opacity-40"
                :class="svc.status === 'ok'
                  ? 'text-green-600 hover:bg-red-50 hover:text-red-500'
                  : 'text-gray-400 hover:bg-green-50 hover:text-green-600'"
                :disabled="!!acting[String(name)]"
                @click="svcAction(String(name), svc.status === 'ok' ? 'stop' : 'start')"
              >
                <Loader2Icon
                  v-if="acting[String(name)] === 'start' || acting[String(name)] === 'stop'"
                  class="w-3 h-3 animate-spin"
                />
                <PowerIcon
                  v-else
                  class="w-3 h-3"
                />
                {{ svc.status === 'ok' ? 'Stop' : 'Start' }}
              </button>
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
            class="p-2 rounded-xl border border-gray-100 flex items-center gap-3"
          >
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="printerIconBg(printer)"
            >
              <PrinterIcon
                class="w-4 h-4"
                :class="printerIconColor(printer)"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="text-sm font-medium text-gray-900 truncate">
                  {{ printer.name }}
                </p>
                <StatusBadge
                  :status="printerStatus(printer)"
                  :label="printerLabel(printer)"
                />
                <span
                  v-if="driverConcerning(printer)"
                  class="text-xs font-medium text-amber-700 bg-amber-50 rounded px-1.5 py-0.5"
                  title="No driver bound — this printer can't report paper-out, jam, or toner status."
                >⚠ No driver</span>
              </div>
              <p class="text-xs text-gray-500 truncate">
                {{ printer.driverName || printer.uri }}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Scanners
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
          v-if="devices.scanners.length === 0"
          class="text-sm text-gray-500"
        >
          No scanners detected.
        </div>
        <div
          v-else
          class="space-y-2"
        >
          <div
            v-for="scanner in devices.scanners"
            :key="scanner.device"
            class="p-2 rounded-xl border border-gray-100 flex items-center gap-3"
          >
            <div class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <ScanIcon class="w-4 h-4 text-green-600" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="text-sm font-medium text-gray-900 truncate">
                  {{ scanner.vendor }} {{ scanner.model }}
                </p>
                <span
                  v-if="scanner.default"
                  class="text-xs font-medium text-blue-600 bg-blue-50 rounded px-1.5 py-0.5"
                >Default</span>
              </div>
              <p class="text-xs text-gray-500 truncate">
                {{ scanner.device }} · {{ scanner.type }}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </section>

    <!-- ── Recent activity (scans + prints) ─────────────────────────────── -->
    <section class="grid lg:grid-cols-2 gap-3">
      <div>
        <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Recent Scans
        </h2>
        <FileList :max="5" />
      </div>
      <div>
        <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Recent Prints
        </h2>
        <div
          v-if="recentPrints.length === 0"
          class="text-center py-10 text-gray-400 text-sm border border-dashed rounded-xl"
        >
          No print jobs yet
        </div>
        <div
          v-else
          class="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden bg-white"
        >
          <div
            v-for="job in recentPrints"
            :key="job.id"
            class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="printJobBg(job.state)"
            >
              <PrinterIcon
                class="w-4 h-4"
                :class="printJobColor(job.state)"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 truncate">
                {{ job.name }}
              </p>
              <p class="text-xs text-gray-400 truncate">
                {{ printJobLabel(job.state) }} · {{ job.created }}
              </p>
            </div>
          </div>
        </div>
      </div>
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

  <!-- ── Scan Files modal ────────────────────────────────────────────── -->
  <Modal
    v-model="showScans"
    title="Scan Files"
  >
    <FileList :max="200" />
  </Modal>

  <!-- ── Print Queue modal ──────────────────────────────────────────── -->
  <Modal
    v-model="showQueue"
    title="Print Queue"
  >
    <div
      v-if="print.jobs.length === 0"
      class="text-sm text-gray-400 text-center py-8"
    >
      No jobs in queue
    </div>
    <div
      v-else
      class="divide-y divide-gray-100"
    >
      <div
        v-for="job in print.jobs"
        :key="job.id"
        class="flex items-center gap-3 py-3"
      >
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate">
            {{ job.name }}
          </p>
          <p class="text-xs text-gray-400">
            {{ job.state }} · {{ job.created }}
          </p>
        </div>
        <button
          type="button"
          class="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
          :title="`Cancel ${job.name}`"
          :disabled="cancelingJob === job.id"
          @click="cancelPrintJob(job.id)"
        >
          <Loader2Icon
            v-if="cancelingJob === job.id"
            class="w-4 h-4 animate-spin"
          />
          <CircleXIcon
            v-else
            class="w-4 h-4"
          />
        </button>
      </div>
    </div>
    <template #footer>
      <button
        v-if="print.jobs.length > 0"
        type="button"
        class="text-xs text-red-500 hover:text-red-600 font-medium disabled:opacity-40"
        :disabled="!!cancelingJob"
        @click="cancelAllJobs"
      >
        Cancel All
      </button>
    </template>
  </Modal>

  <!-- ── Service Errors modal ───────────────────────────────────────── -->
  <Modal
    v-model="showErrors"
    title="Service Errors"
  >
    <div
      v-if="errorServices.length === 0"
      class="text-sm text-gray-400 text-center py-8"
    >
      No errors detected
    </div>
    <div
      v-else
      class="space-y-3"
    >
      <div
        v-for="svc in errorServices"
        :key="svc.name"
        class="flex items-start gap-3 p-3 rounded-xl border border-red-100 bg-red-50"
      >
        <AlertCircleIcon class="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
        <div>
          <p class="text-sm font-semibold text-gray-900 capitalize">
            {{ svc.name }}
          </p>
          <p class="text-xs text-gray-500 mt-0.5">
            {{ svc.message || svc.status }}
          </p>
        </div>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ScanIcon, PrinterIcon, UsbIcon, ShareIcon,
  CheckCircleIcon, AlertCircleIcon, PrinterIcon as PrintIcon,
  FileTextIcon, DatabaseIcon, WifiIcon, ShieldIcon, Settings2Icon,
  RotateCcwIcon, PowerIcon, Loader2Icon, CircleXIcon,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import AppShell   from '@/components/layout/AppShell.vue'
import Button     from '@/components/ui/Button.vue'
import Card       from '@/components/ui/Card.vue'
import Modal      from '@/components/ui/Modal.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import FileList   from '@/components/scan/FileList.vue'
import { useSystemStore } from '@/stores/system'
import { useScanStore }   from '@/stores/scan'
import { usePrintStore }  from '@/stores/print'
import { useDevicesStore } from '@/stores/devices'
import { usePrinterStatus } from '@/composables/usePrinterStatus'
import { useApi }         from '@/composables/useApi'

interface JobsSnapshot {
  print: { jobs: Array<{ id: string; name: string; state: string }>; count: number }
  scan:  { active: number; queued: number; completed: number; lastDurationMs: number; lastStartedAt: string | null; lastFinishedAt: string | null }
}

const system = useSystemStore()
const scan   = useScanStore()
const print  = usePrintStore()
const devices = useDevicesStore()
const { printerStatus, printerLabel, printerIconBg, printerIconColor, driverConcerning } = usePrinterStatus()
const jobsApi = useApi<JobsSnapshot>()
const jobs = ref<JobsSnapshot | null>(null)
let jobsTimer: ReturnType<typeof setInterval> | null = null
let deviceTimer: ReturnType<typeof setInterval> | null = null

// service action state: maps service name → current action in flight
const acting = ref<Record<string, string>>({})

// ── Drilldown modals ──────────────────────────────────────────────────────
const showScans  = ref(false)
const showQueue  = ref(false)
const showErrors = ref(false)
const cancelingJob = ref<string | null>(null)

async function cancelPrintJob(id: string) {
  cancelingJob.value = id
  try {
    await print.cancelJob(id)
  } finally {
    cancelingJob.value = null
  }
}

async function cancelAllJobs() {
  for (const job of print.jobs) {
    await cancelPrintJob(job.id)
  }
}

const errorServices = computed(() => {
  if (!system.health) return []
  return Object.entries(system.health.services)
    .filter(([, s]) => s.status === 'error' || s.status === 'offline')
    .map(([name, s]) => ({ name, status: s.status, message: s.message }))
})

async function svcAction(name: string, action: 'start' | 'stop' | 'restart') {
  acting.value = { ...acting.value, [name]: action }
  try {
    const r = await fetch(`/api/v1/services/${name}/${action}`, { method: 'POST' })
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: `${action} failed` })) as { error?: string }
      throw new Error(err.error ?? `${action} failed`)
    }
    // Refresh health after a short delay so systemd has time to update state
    setTimeout(() => system.fetchHealth(), 1200)
  } catch (err) {
    // Surface error by refreshing health (status will flip to error/offline)
    await system.fetchHealth()
    console.warn(`svcAction ${action} ${name}:`, err)
  } finally {
    const next = { ...acting.value }
    delete next[name]
    acting.value = next
  }
}

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


// Only count non-disabled services for health stats
const enabledServices = computed(() => {
  if (!system.health) return []
  return Object.entries(system.health.services)
    .filter(([, s]) => s.status !== 'disabled')
})
const healthyCount = computed(() => enabledServices.value.filter(([, s]) => s.status === 'ok').length)
const totalCount = computed(() => enabledServices.value.length)

// Map service name to human-readable capability
const SERVICE_CAPABILITIES: Record<string, string> = {
  cups: 'Print',
  'ipp-usb': 'USB-over-IP',
  scanservjs: 'Scan',
  samba: 'File Share',
  nfs: 'NFS',
  nginx: 'Web UI',
  paperless: 'Cloud Docs',
  tailscale: 'Remote Access',
  cloudflared: 'Cloud Tunnel',
}

// Compute enabled capabilities summary (for main box)
const enabledCapabilities = computed(() => {
  return enabledServices.value
    .map(([name]) => SERVICE_CAPABILITIES[name] || name)
    .filter(Boolean)
    .join(', ')
})

// Compute per-service capability label
function serviceCapability(name: string): string {
  return SERVICE_CAPABILITIES[name] || name
}

const diskSub = computed(() => {
  const disk = system.health?.disk
  if (!disk) return 'On this device'
  if (disk.status === 'critical') return `⚠ Disk ${disk.percentUsed}% full`
  if (disk.status === 'warning')  return `Disk ${disk.percentUsed}% full`
  return 'On this device'
})
const diskSubColor = computed(() => {
  const status = system.health?.disk?.status
  if (status === 'critical') return 'text-red-500'
  if (status === 'warning')  return 'text-amber-600'
  return 'text-gray-400'
})

const stats = computed(() => {
  let servicesSub: string
  if (healthyCount.value === totalCount.value && totalCount.value > 0) {
    servicesSub = enabledCapabilities.value ? enabledCapabilities.value : 'All healthy'
  } else {
    servicesSub = 'Check status'
  }
  return [
    {
      label: 'Services',
      value: `${healthyCount.value}/${totalCount.value}`,
      sub: servicesSub,
      subColor: healthyCount.value === totalCount.value && totalCount.value > 0 ? 'text-green-600' : 'text-amber-600',
      icon:  CheckCircleIcon,
      bg:    'bg-green-50',
      color: 'text-green-600',
      onClick: undefined as (() => void) | undefined,
    },
  {
    label: 'Scan Files',
    value: String(scan.files.length),
    sub:   diskSub.value,
    subColor: diskSubColor.value,
    icon:  ScanIcon,
    bg:    'bg-blue-50',
    color: 'text-blue-600',
    onClick: () => { showScans.value = true },
  },
  {
    label: 'Print Queue',
    value: String(print.jobs.length),
    sub:   print.printerState === 'ok' ? 'Printer ready' : 'Printer offline',
    subColor: print.printerState === 'ok' ? 'text-green-600' : 'text-red-500',
    icon:  PrinterIcon,
    bg:    'bg-purple-50',
    color: 'text-purple-600',
    onClick: () => { showQueue.value = true },
  },
  {
    label: 'Errors',
    value: String(Object.values(system.health?.services ?? {}).filter(s => s.status === 'error').length),
    sub:   'Requires attention',
    subColor: 'text-gray-400',
    icon:  AlertCircleIcon,
    bg:    'bg-red-50',
    color: 'text-red-500',
    onClick: () => { showErrors.value = true },
  },
  ]
})

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

const recentPrints = computed(() => print.jobs.slice(0, 5))

function printJobBg(state: string) {
  if (state === 'completed')                return 'bg-green-50'
  if (state === 'failed' || state === 'canceled') return 'bg-red-50'
  return 'bg-purple-50'
}
function printJobColor(state: string) {
  if (state === 'completed')                return 'text-green-600'
  if (state === 'failed' || state === 'canceled') return 'text-red-500'
  return 'text-purple-600'
}
function printJobLabel(state: string) {
  if (state === 'completed') return 'Completed'
  if (state === 'failed')    return 'Failed'
  if (state === 'canceled')  return 'Canceled'
  if (state === 'processing') return 'Printing'
  return state.charAt(0).toUpperCase() + state.slice(1)
}
</script>
