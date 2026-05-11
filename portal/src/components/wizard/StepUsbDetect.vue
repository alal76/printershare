<!-- Beta test version v1.2.0 -->
<template>
  <div class="space-y-5">
    <h3 class="font-semibold text-gray-900">
      Detect Devices
    </h3>
    <p class="text-sm text-gray-500">
      Connect your USB printer and/or scanner, then click the scan buttons below.
    </p>

    <!-- ── Printer (USB) section ──────────────────────────────────── -->
    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Printers
        </h4>
        <button
          type="button"
          class="btn-secondary text-xs py-1 px-3"
          :disabled="scanningUsb"
          @click="scanUsb"
        >
          <Loader2Icon
            v-if="scanningUsb"
            class="w-3 h-3 animate-spin"
          />
          <UsbIcon
            v-else
            class="w-3 h-3"
          />
          {{ scanningUsb ? 'Scanning…' : 'Scan USB' }}
        </button>
      </div>

      <div
        v-if="printers.length === 0 && !scanningUsb"
        class="text-sm text-gray-400 text-center py-4 border border-dashed rounded-xl"
      >
        No printers detected yet
      </div>

      <button
        v-for="d in printers"
        :key="d.vidpid"
        type="button"
        class="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors"
        :class="selectedPrinter?.vidpid === d.vidpid
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-200 hover:border-primary-200'"
        @click="selectPrinter(d)"
      >
        <PrinterIcon class="w-5 h-5 text-gray-400 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate">
            {{ d.name }}
          </p>
          <p class="text-xs text-gray-500">
            {{ d.vidpid }}{{ d.make ? ` · ${d.make}` : '' }}
          </p>
        </div>
        <div class="flex gap-1 flex-shrink-0">
          <span
            v-if="d.capabilities.escl"
            class="text-xs bg-purple-50 text-purple-600 rounded px-1.5 py-0.5"
          >AirPrint</span>
        </div>
      </button>
    </section>

    <!-- ── Scanner section ────────────────────────────────────────── -->
    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Scanners
        </h4>
        <button
          type="button"
          class="btn-secondary text-xs py-1 px-3"
          :disabled="scanningUsb || scanningScanner"
          @click="scanScanners"
        >
          <Loader2Icon
            v-if="scanningScanner"
            class="w-3 h-3 animate-spin"
          />
          <ScanIcon
            v-else
            class="w-3 h-3"
          />
          {{ scanningScanner ? 'Scanning…' : 'Scan SANE' }}
        </button>
      </div>

      <!-- USB-detected scanners -->
      <button
        v-for="d in usbScanners"
        :key="d.vidpid"
        type="button"
        class="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors"
        :class="selectedScanner?.id === d.vidpid
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-200 hover:border-primary-200'"
        @click="selectScanner({ id: d.vidpid, description: d.name, source: 'usb', device: d })"
      >
        <ScanIcon class="w-5 h-5 text-gray-400 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate">
            {{ d.name }}
          </p>
          <p class="text-xs text-gray-500">
            {{ d.vidpid }} · USB
          </p>
        </div>
        <span class="text-xs bg-gray-100 text-gray-500 rounded px-1.5 py-0.5 flex-shrink-0">USB</span>
      </button>

      <!-- SANE-detected scanners -->
      <button
        v-for="s in saneDevices"
        :key="s.device"
        type="button"
        class="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors"
        :class="selectedScanner?.id === s.device
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-200 hover:border-primary-200'"
        @click="selectScanner({ id: s.device, description: s.description, source: 'sane' })"
      >
        <ScanIcon class="w-5 h-5 text-gray-400 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate">
            {{ s.description }}
          </p>
          <p class="text-xs text-gray-500">
            {{ s.device }}
          </p>
        </div>
        <span class="text-xs bg-green-50 text-green-600 rounded px-1.5 py-0.5 flex-shrink-0">SANE</span>
      </button>

      <div
        v-if="usbScanners.length === 0 && saneDevices.length === 0 && !scanningScanner && !scanningUsb"
        class="text-sm text-gray-400 text-center py-4 border border-dashed rounded-xl"
      >
        No scanners detected yet — click "Scan SANE" after connecting scanner
      </div>
    </section>

    <!-- ── Virtual / software printers ──────────────────────────────── -->
    <section class="space-y-2">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Software Printers
      </h4>
      <p class="text-xs text-gray-400">
        No physical printer needed — print to a file on the server.
      </p>

      <button
        v-for="vp in VIRTUAL_PRINTERS"
        :key="vp.id"
        type="button"
        class="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors"
        :class="selectedVirtual === vp.id
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-200 hover:border-primary-200'"
        @click="selectVirtual(vp.id)"
      >
        <component
          :is="vp.icon"
          class="w-5 h-5 text-gray-400 flex-shrink-0"
        />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900">
            {{ vp.label }}
          </p>
          <p class="text-xs text-gray-500">
            {{ vp.description }}
          </p>
        </div>
        <span class="text-xs bg-blue-50 text-blue-600 rounded px-1.5 py-0.5 flex-shrink-0">virtual</span>
      </button>
    </section>

    <p class="text-xs text-amber-600">
      <span v-if="!selectedPrinter && !selectedScanner && !selectedVirtual">
        Select at least one device, or
      </span>
      <button
        type="button"
        class="underline"
        @click="skip"
      >
        skip (no device connected)
      </button>
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { UsbIcon, ScanIcon, PrinterIcon, Loader2Icon, FileTextIcon, FileIcon } from 'lucide-vue-next'

interface UsbDevice {
  vidpid: string
  name:   string
  make:   string
  model:  string
  capabilities: { print: boolean; scan: boolean; fax: boolean; escl: boolean }
}

interface SaneDevice {
  device:      string
  description: string
}

interface SelectedScanner {
  id:          string
  description: string
  source:      'usb' | 'sane'
  device?:     UsbDevice
}

interface VirtualPrinter {
  id:          'pdf' | 'xps'
  label:       string
  description: string
  icon:        unknown
}

const VIRTUAL_PRINTERS: VirtualPrinter[] = [
  {
    id:          'pdf',
    label:       'PDF Printer',
    description: 'Print to PDF — files saved to /var/spool/cups-pdf/',
    icon:        FileTextIcon,
  },
  {
    id:          'xps',
    label:       'XPS Printer',
    description: 'Print to XPS (Open XML Paper) — files saved to /var/spool/xps-printer/',
    icon:        FileIcon,
  },
]

const props = defineProps<{ config: Record<string, string> }>()
const emit  = defineEmits<{
  (e: 'update:config', v: Record<string, string>): void
  (e: 'valid', v: boolean): void
}>()

const scanningUsb     = ref(false)
const scanningScanner = ref(false)
const allUsbDevices   = ref<UsbDevice[]>([])
const saneDevices     = ref<SaneDevice[]>([])
const selectedPrinter = ref<UsbDevice | null>(null)
const selectedScanner = ref<SelectedScanner | null>(null)
const selectedVirtual = ref<'pdf' | 'xps' | null>(null)

const printers    = computed(() => allUsbDevices.value.filter(d => d.capabilities.print))
const usbScanners = computed(() => allUsbDevices.value.filter(d => d.capabilities.scan && !d.capabilities.print))

async function scanUsb() {
  scanningUsb.value = true
  try {
    const r = await fetch('/api/v1/system/usb')
    const d = await r.json() as { devices: UsbDevice[] }
    allUsbDevices.value = d.devices ?? []
    // Auto-select if only one printer found
    if (printers.value.length === 1 && !selectedPrinter.value) {
      selectPrinter(printers.value[0])
    }
    // Also auto-detect SANE if not done yet
    if (saneDevices.value.length === 0) scanScanners()
  } finally {
    scanningUsb.value = false
  }
}

async function scanScanners() {
  scanningScanner.value = true
  try {
    const r = await fetch('/api/v1/wizard/scan-devices')
    const d = await r.json() as { scanners: SaneDevice[] }
    saneDevices.value = d.scanners ?? []
    if (saneDevices.value.length === 1 && !selectedScanner.value) {
      selectScanner({ id: saneDevices.value[0].device, description: saneDevices.value[0].description, source: 'sane' })
    }
  } finally {
    scanningScanner.value = false
  }
}

function selectPrinter(d: UsbDevice) {
  selectedPrinter.value = d
  selectedVirtual.value = null
  pushConfig()
}

function selectScanner(s: SelectedScanner) {
  selectedScanner.value = s
  pushConfig()
}

function selectVirtual(id: 'pdf' | 'xps') {
  // Toggle off if already selected
  if (selectedVirtual.value === id) {
    selectedVirtual.value = null
    selectedPrinter.value = null
    pushConfig()
    return
  }
  selectedVirtual.value = id
  selectedPrinter.value = null
  pushConfig()
}

function pushConfig() {
  const patch: Record<string, string> = { ...props.config }

  // Clear device fields — rebuilt from current selections below
  delete patch.USB_VID
  delete patch.USB_PID
  delete patch.DETECTED_MAKE
  delete patch.DETECTED_CAPS
  delete patch.VIRTUAL_PRINTER

  applyPrinterPatch(patch)
  applyScannerPatch(patch)

  emit('update:config', patch)
  emit('valid', true)
}

function applyPrinterPatch(patch: Record<string, string>) {
  if (selectedVirtual.value) {
    patch.VIRTUAL_PRINTER = selectedVirtual.value
    patch.DETECTED_MAKE   = selectedVirtual.value === 'pdf' ? 'Virtual-PDF' : 'Virtual-XPS'
    patch.DETECTED_CAPS   = 'print'
    return
  }
  const p = selectedPrinter.value
  if (!p) return
  patch.USB_VID       = p.vidpid.split(':')[0]
  patch.USB_PID       = p.vidpid.split(':')[1]
  patch.DETECTED_MAKE = p.make || ''
  patch.DETECTED_CAPS = [
    p.capabilities.print ? 'print' : '',
    p.capabilities.scan  ? 'scan'  : '',
    p.capabilities.escl  ? 'escl'  : '',
  ].filter(Boolean).join(',')
}

function applyScannerPatch(patch: Record<string, string>) {
  const s = selectedScanner.value
  if (!s) return
  patch.SCANNER_DEVICE = s.id
  if (!patch.DETECTED_MAKE && s.device?.make) patch.DETECTED_MAKE = s.device.make
  if (!patch.DETECTED_CAPS) patch.DETECTED_CAPS = 'scan'
}

function skip() {
  emit('valid', true)
}
</script>

