<template>
  <AppShell title="Print">
    <div class="max-w-2xl space-y-6">
      <!-- ── Upload & Print ─────────────────────────────────────────────── -->
      <Card>
        <h2 class="text-sm font-semibold text-gray-900 mb-4">
          Upload & Print
        </h2>
        <form
          class="space-y-4"
          @submit.prevent="submit"
        >
          <!-- Printer selector -->
          <div v-if="devicesStore.printers.length > 0">
            <label
              for="printer-select"
              class="block text-xs font-medium text-gray-700 mb-1"
            >Printer</label>
            <select
              id="printer-select"
              v-model="selectedPrinter"
              class="w-full rounded-xl border-gray-200 text-sm"
            >
              <option
                v-for="p in devicesStore.printers"
                :key="p.name"
                :value="p.name"
              >
                {{ p.name }} — {{ p.state }}
              </option>
            </select>
          </div>

          <!-- Drop zone -->
          <div
            class="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors select-none"
            :class="dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300'"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
            @click="fileInput?.click()"
          >
            <UploadCloudIcon class="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p class="text-sm text-gray-500">
              Drag a <b>PDF</b> or image here, or
              <span class="text-primary-600 font-medium">browse</span>
            </p>
            <p class="text-xs text-gray-400 mt-1">
              PDF · JPEG · PNG · TIFF · up to 100 MB
            </p>
            <div
              v-if="file"
              class="mt-3 inline-flex items-center gap-2 bg-primary-50 text-primary-700 text-xs font-medium px-3 py-1.5 rounded-lg"
            >
              <FileTextIcon class="w-3.5 h-3.5" />
              {{ file.name }}
              <button
                type="button"
                class="ml-1 text-primary-400 hover:text-primary-700"
                @click.stop="file = null"
              >
                <XIcon class="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.tiff"
            class="sr-only"
            @change="onFileChange"
          />

          <!-- Options row -->
          <div class="flex gap-3">
            <div class="flex-1">
              <label
                for="copies"
                class="block text-xs font-medium text-gray-700 mb-1"
              >Copies</label>
              <input
                id="copies"
                v-model="copies"
                type="number"
                min="1"
                max="99"
                class="w-full rounded-xl border-gray-200 text-sm"
              />
            </div>
            <div class="flex-1">
              <label
                for="color-mode"
                class="block text-xs font-medium text-gray-700 mb-1"
              >Color</label>
              <select
                id="color-mode"
                v-model="colorMode"
                class="w-full rounded-xl border-gray-200 text-sm"
              >
                <option value="auto">
                  Auto
                </option>
                <option value="color">
                  Color
                </option>
                <option value="mono">
                  Black & White
                </option>
              </select>
            </div>
          </div>

          <Button
            type="submit"
            class="w-full"
            :loading="printing"
            :disabled="!file"
          >
            <PrinterIcon class="w-4 h-4" />
            {{ printing ? 'Sending to printer…' : 'Print' }}
          </Button>
        </form>
      </Card>

      <!-- ── Print queue ───────────────────────────────────────────────── -->
      <Card v-if="printStore.jobs.length > 0">
        <h2 class="text-sm font-semibold text-gray-900 mb-3">
          Print Queue
        </h2>
        <div class="space-y-2">
          <div
            v-for="job in printStore.jobs"
            :key="job.id"
            class="flex items-center gap-3 text-sm p-2 rounded-xl hover:bg-gray-50"
          >
            <PrinterIcon class="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span class="flex-1 truncate">{{ job.name }}</span>
            <StatusBadge
              :status="job.state === 'processing' ? 'pending' : 'ok'"
              :label="job.state"
            />
          </div>
        </div>
      </Card>

      <!-- ── How to print from your device ────────────────────────────── -->
      <Card :padding="false">
        <div class="p-4 border-b border-gray-100">
          <h2 class="text-sm font-semibold text-gray-900">
            Print from Your Device
          </h2>
          <p class="text-xs text-gray-500 mt-0.5">
            No driver installation needed on most platforms.
          </p>
        </div>
        <div class="flex border-b border-gray-100 overflow-x-auto scrollbar-hidden">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="px-4 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap transition-colors"
            :class="activeTab === tab.id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          class="p-4 text-sm text-gray-600 leading-relaxed"
          v-html="activeInstructions"
        ></div>
      </Card>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { PrinterIcon, UploadCloudIcon, FileTextIcon, XIcon } from 'lucide-vue-next'
import AppShell   from '@/components/layout/AppShell.vue'
import Card       from '@/components/ui/Card.vue'
import Button     from '@/components/ui/Button.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { usePrintStore }   from '@/stores/print'
import { useDevicesStore } from '@/stores/devices'
import { useToastStore }   from '@/stores/toast'

const printStore   = usePrintStore()
const devicesStore = useDevicesStore()
const toast        = useToastStore()

const file            = ref<File | null>(null)
const printing        = ref(false)
const dragging        = ref(false)
const fileInput       = ref<HTMLInputElement | null>(null)
const activeTab       = ref('macos')
const selectedPrinter = ref('default')
const copies          = ref(1)
const colorMode       = ref('auto')

onMounted(async () => {
  await Promise.all([printStore.fetchQueue(), devicesStore.fetchDevices()])
  if (devicesStore.printers.length > 0) {
    selectedPrinter.value = devicesStore.printers[0].name
  }
})

function onFileChange(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null
}
function onDrop(e: DragEvent) {
  dragging.value = false
  file.value = e.dataTransfer?.files[0] ?? null
}

async function submit() {
  if (!file.value) return
  printing.value = true
  try {
    await printStore.printFile(file.value, selectedPrinter.value)
    toast.success('Print job sent!')
    file.value = null
  } catch (err) {
    toast.error('Print failed', err instanceof Error ? err.message : String(err))
  } finally {
    printing.value = false
  }
}

const tabs = [
  { id: 'macos',   label: 'macOS / iOS' },
  { id: 'windows', label: 'Windows' },
  { id: 'android', label: 'Android' },
  { id: 'linux',   label: 'Linux' },
]

const host = computed(() => globalThis.location?.hostname ?? 'printershare.local')

const instructions: Record<string, string> = {
  macos:   `<strong>AirPrint</strong> — Your printer is automatically discovered. Open any document, tap <b>Print</b> — no driver needed.`,
  windows: `<strong>IPP Everywhere</strong> — Go to <b>Settings → Bluetooth & devices → Printers & scanners → Add device</b>. Windows auto-discovers it. If not found, choose <b>Add manually</b> and enter:<br><code class="text-xs bg-gray-100 px-1.5 py-0.5 rounded">http://${host.value}:631/printers/USB-Printer</code>`,
  android: `<strong>Mopria Print Service</strong> — Install from the Play Store, then tap Print in any app. The printer appears automatically.`,
  linux:   `<strong>CUPS</strong> — Run:<br><code class="text-xs bg-gray-100 px-1.5 py-0.5 rounded">sudo lpadmin -p MyPrinter -E -v ipp://${host.value}:631/printers/USB-Printer -m everywhere</code><br>Then: <code class="text-xs bg-gray-100 px-1.5 py-0.5 rounded">lpoptions -d MyPrinter</code>`,
}

const activeInstructions = computed(() => instructions[activeTab.value] ?? '')
</script>
