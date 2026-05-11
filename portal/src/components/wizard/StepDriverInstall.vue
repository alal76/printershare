<!-- Beta test version v1.2.0 -->
<template>
  <div class="space-y-4">
    <h3 class="font-semibold text-gray-900">
      Install Drivers
    </h3>
    <p class="text-sm text-gray-500">
      Checking whether the detected device needs additional drivers.
    </p>

    <!-- No device detected — skip -->
    <div
      v-if="!hasDevice"
      class="p-4 bg-gray-50 rounded-xl text-sm text-gray-500"
    >
      No device was detected in the previous step — skipping driver check.
    </div>

    <!-- Driver check results -->
    <div
      v-else
      class="space-y-3"
    >
      <!-- Per-capability check rows -->
      <div
        v-for="row in checkRows"
        :key="row.type"
        class="flex items-start gap-3 p-3 rounded-xl border"
        :class="rowBorder(row)"
      >
        <div class="flex-shrink-0 mt-0.5">
          <CheckCircleIcon
            v-if="row.state === 'ok'"
            class="w-5 h-5 text-green-500"
          />
          <AlertCircleIcon
            v-else-if="row.state === 'warn'"
            class="w-5 h-5 text-amber-500"
          />
          <XCircleIcon
            v-else-if="row.state === 'error'"
            class="w-5 h-5 text-red-500"
          />
          <Loader2Icon
            v-else
            class="w-5 h-5 text-gray-400 animate-spin"
          />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900">
            {{ row.label }}
          </p>
          <p
            v-if="row.detail"
            class="text-xs text-gray-500 mt-0.5"
          >
            {{ row.detail }}
          </p>
        </div>
      </div>

      <!-- Per-device quirks note (from device-quirks.json) -->
      <p
        v-if="quirksNote"
        class="text-xs text-blue-700 bg-blue-50 border border-blue-100 p-3 rounded-xl"
        data-testid="quirks-note"
      >
        <span class="font-semibold">Device note:</span> {{ quirksNote }}
      </p>

      <!-- Nothing to install -->
      <p
        v-if="checking === false && !hasMissing"
        class="text-sm text-green-700 bg-green-50 p-3 rounded-xl"
      >
        All required drivers are already installed.
      </p>

      <!-- Install button -->
      <div
        v-if="hasMissing && !installDone"
        class="flex gap-2"
      >
        <Button
          :loading="installing"
          @click="installDrivers"
        >
          Install Missing Drivers
        </Button>
        <Button
          variant="ghost"
          @click="done"
        >
          Skip (do later)
        </Button>
      </div>

      <!-- SSE install log -->
      <div
        v-if="logs.length"
        ref="logPanel"
        class="bg-gray-900 rounded-xl p-3 font-mono text-xs text-gray-200 max-h-48 overflow-y-auto"
      >
        <p
          v-for="(line, i) in logs"
          :key="i"
          :class="line.startsWith('✓') ? 'text-green-400' : line.toLowerCase().includes('error') ? 'text-red-400' : ''"
        >
          {{ line }}
        </p>
      </div>

      <!-- Final error -->
      <p
        v-if="installError"
        class="text-sm text-red-700 bg-red-50 p-3 rounded-xl"
      >
        {{ installError }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { CheckCircleIcon, XCircleIcon, AlertCircleIcon, Loader2Icon } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'

interface DriverResult {
  ok:       boolean
  packages: string[]
  detail:   string
}

interface CheckRow {
  type:   'print' | 'scan'
  label:  string
  state:  'pending' | 'ok' | 'warn' | 'error'
  detail: string
}

const props = defineProps<{ config: Record<string, string> }>()
const emit  = defineEmits<{ (e: 'valid', v: boolean): void }>()

const hasDevice   = computed(() => !!(props.config.USB_VID || props.config.SCANNER_DEVICE || props.config.VIRTUAL_PRINTER))
const isVirtual   = computed(() => !!props.config.VIRTUAL_PRINTER)
const make        = computed(() => props.config.DETECTED_MAKE || '')
const vidpid      = computed(() => props.config.USB_VID && props.config.USB_PID
  ? `${props.config.USB_VID}:${props.config.USB_PID}` : '')
const rawCaps     = computed(() => props.config.DETECTED_CAPS || '')
const wantPrint   = computed(() => rawCaps.value.includes('print'))
const wantScan    = computed(() => rawCaps.value.includes('scan'))

const checking    = ref<boolean | null>(null)  // null = not started, true = in progress, false = done
const checkRows   = ref<CheckRow[]>([])
const quirksNote  = ref<string>('')
const hasMissing  = computed(() => checkRows.value.some(r => r.state === 'warn'))
const installing  = ref(false)
const installDone = ref(false)
const installError = ref('')
const logs        = ref<string[]>([])
const logPanel    = ref<HTMLElement | null>(null)

function rowBorder(row: CheckRow) {
  return {
    ok:      'border-green-100 bg-green-50',
    warn:    'border-amber-100 bg-amber-50',
    error:   'border-red-100 bg-red-50',
    pending: 'border-gray-100',
  }[row.state]
}

function checkVirtualDriver() {
  const label = make.value === 'Virtual-PDF' ? 'PDF printer (printer-driver-cups-pdf)' : 'XPS printer (ghostscript)'
  const pkgs  = make.value === 'Virtual-PDF' ? 'printer-driver-cups-pdf' : 'printer-driver-cups-pdf, ghostscript'
  checkRows.value = [{
    type:   'print',
    label,
    state:  'warn',
    detail: `Will install: ${pkgs} and create CUPS queue`,
  }]
  checking.value = false
}

function applyQuirksNote(q?: { matched?: string, name?: string, notes?: string } | null) {
  if (!q || !q.matched || q.matched === 'none' || !q.notes) return
  quirksNote.value = q.name ? `${q.name} — ${q.notes}` : q.notes
}

async function checkPhysicalDrivers() {
  if (wantPrint.value) checkRows.value.push({ type: 'print', label: 'Print driver', state: 'pending', detail: '' })
  if (wantScan.value)  checkRows.value.push({ type: 'scan',  label: 'Scan driver',  state: 'pending', detail: '' })

  if (!checkRows.value.length) { checking.value = false; emit('valid', true); return }

  const params = new URLSearchParams({
    vidpid: vidpid.value,
    make:   make.value,
    print:  wantPrint.value ? '1' : '0',
    scan:   wantScan.value  ? '1' : '0',
  })

  try {
    const r    = await fetch(`/api/v1/wizard/driver-check?${params}`)
    const data = await r.json() as {
      print?: DriverResult | null
      scan?:  DriverResult | null
      quirks?: { matched?: string, name?: string, notes?: string } | null
    }
    updateRow('print', data.print)
    updateRow('scan',  data.scan)
    applyQuirksNote(data.quirks)
  } catch (err) {
    for (const row of checkRows.value) {
      row.state  = 'error'
      row.detail = err instanceof Error ? err.message : 'Network error'
    }
  } finally {
    checking.value = false
    if (!hasMissing.value) emit('valid', true)
  }
}

async function checkDrivers() {
  if (!hasDevice.value) { emit('valid', true); return }
  checking.value = true
  checkRows.value = []
  if (isVirtual.value) { checkVirtualDriver(); return }
  await checkPhysicalDrivers()
}

function updateRow(type: 'print' | 'scan', result?: DriverResult | null) {
  const row = checkRows.value.find(r => r.type === type)
  if (!row || !result) return
  row.state  = result.ok ? 'ok' : 'warn'
  row.detail = result.detail
}

async function installDrivers() {
  installing.value   = true
  installError.value = ''
  logs.value         = []

  const caps = rawCaps.value.split(',').filter(Boolean)
  const resp = await fetch('/api/v1/wizard/driver-install', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ make: make.value, vidpid: vidpid.value, capabilities: caps }),
  })

  if (!resp.body) {
    installError.value = 'No response stream'
    installing.value   = false
    return
  }

  await consumeSseStream(resp.body)
  installing.value = false
}

async function consumeSseStream(body: ReadableStream<Uint8Array>) {
  const reader  = body.getReader()
  const decoder = new TextDecoder()
  let   buf     = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) processSeePart(part)
    await nextTick()
    if (logPanel.value) logPanel.value.scrollTop = logPanel.value.scrollHeight
  }
}

function processSeePart(part: string) {
  for (const line of part.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const ev = JSON.parse(line.slice(5).trim()) as { type: string; data: string }
      if (ev.type === 'log')      logs.value.push(ev.data)
      if (ev.type === 'error')    { installError.value = ev.data; installing.value = false }
      if (ev.type === 'complete') { installDone.value = true; installing.value = false; emit('valid', true) }
    } catch { /* malformed SSE chunk */ }
  }
}

function done() {
  emit('valid', true)
}

watch(logs, async () => {
  await nextTick()
  if (logPanel.value) logPanel.value.scrollTop = logPanel.value.scrollHeight
})

onMounted(() => checkDrivers())
</script>
