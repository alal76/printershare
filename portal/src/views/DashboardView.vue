<template>
  <AppShell title="Dashboard">
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

    <!-- ── Recent scans ──────────────────────────────────────────────────── -->
    <section>
      <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Recent Scans
      </h2>
      <FileList :max="5" />
    </section>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import {
  ScanIcon, PrinterIcon, UsbIcon, ShareIcon,
  CheckCircleIcon, AlertCircleIcon, PrinterIcon as PrintIcon,
  FileTextIcon, DatabaseIcon, WifiIcon, ShieldIcon,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import AppShell   from '@/components/layout/AppShell.vue'
import Button     from '@/components/ui/Button.vue'
import FileList   from '@/components/scan/FileList.vue'
import { useSystemStore } from '@/stores/system'
import { useScanStore }   from '@/stores/scan'
import { usePrintStore }  from '@/stores/print'

const system = useSystemStore()
const scan   = useScanStore()
const print  = usePrintStore()

onMounted(async () => {
  system.startPolling()
  await Promise.all([scan.fetchFiles(), print.fetchQueue()])
})
onUnmounted(() => system.stopPolling())

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
