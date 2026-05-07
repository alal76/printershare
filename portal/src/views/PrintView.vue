<template>
  <AppShell title="Print">
    <div class="max-w-2xl space-y-6">
      <!-- Upload & Print -->
      <Card>
        <h2 class="text-sm font-semibold text-gray-900 mb-4">Upload & Print</h2>
        <form class="space-y-3" @submit.prevent="submit">
          <div
            class="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors"
            :class="dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300'"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
            @click="fileInput?.click()"
          >
            <UploadIcon class="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p class="text-sm text-gray-500">Drag PDF or image here, or <span class="text-primary-600">browse</span></p>
            <p v-if="file" class="text-xs text-primary-700 font-medium mt-2">{{ file.name }}</p>
          </div>
          <input ref="fileInput" type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff" class="sr-only" @change="onFileChange" />
          <Button type="submit" class="w-full" :loading="printing" :disabled="!file">
            <PrinterIcon class="w-4 h-4" />
            {{ printing ? 'Sending to printer…' : 'Print' }}
          </Button>
        </form>
      </Card>

      <!-- Platform instructions -->
      <Card :padding="false">
        <div class="flex border-b border-gray-100">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="px-4 py-3 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === tab.id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
        <div class="p-4 text-sm text-gray-600 leading-relaxed" v-html="activeInstructions" />
      </Card>

      <!-- Print queue -->
      <Card v-if="printStore.jobs.length > 0">
        <h2 class="text-sm font-semibold text-gray-900 mb-3">Print Queue</h2>
        <div class="space-y-2">
          <div v-for="job in printStore.jobs" :key="job.id" class="flex items-center gap-3 text-sm">
            <PrinterIcon class="w-4 h-4 text-gray-400" />
            <span class="flex-1">{{ job.name }}</span>
            <StatusBadge :status="job.state === 'processing' ? 'pending' : 'ok'" :label="job.state" />
          </div>
        </div>
      </Card>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { PrinterIcon, UploadIcon }  from 'lucide-vue-next'
import AppShell   from '@/components/layout/AppShell.vue'
import Card       from '@/components/ui/Card.vue'
import Button     from '@/components/ui/Button.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { usePrintStore }  from '@/stores/print'
import { useToastStore }  from '@/stores/toast'

const printStore = usePrintStore()
const toast      = useToastStore()
const file       = ref<File | null>(null)
const printing   = ref(false)
const dragging   = ref(false)
const fileInput  = ref<HTMLInputElement | null>(null)
const activeTab  = ref('macos')

onMounted(() => printStore.fetchQueue())

function onFileChange(e: Event) {
  const el = e.target as HTMLInputElement
  file.value = el.files?.[0] ?? null
}
function onDrop(e: DragEvent) {
  dragging.value = false
  file.value = e.dataTransfer?.files[0] ?? null
}

async function submit() {
  if (!file.value) return
  printing.value = true
  try {
    await printStore.printFile(file.value)
    toast.success('Print job sent!')
    file.value = null
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    toast.error('Print failed', msg)
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

const instructions: Record<string, string> = {
  macos:   `<b>macOS / iOS (AirPrint)</b><br>Your printer is automatically discovered via AirPrint. Open any document and tap <b>Print</b> — no driver installation needed.`,
  windows: `<b>Windows 10/11 (IPP)</b><br>Go to <b>Settings → Bluetooth & devices → Printers & scanners → Add device</b>. Windows will discover the IPP printer automatically.`,
  android: `<b>Android (Mopria)</b><br>Install <b>Mopria Print Service</b> from Google Play, then tap Print in any app. The printer appears automatically on your network.`,
  linux:   `<b>Linux (CUPS)</b><br>Open <b>http://localhost:631</b> or run <code>lpadmin -p MyPrinter -E -v ipp://&lt;host&gt;:631/printers/USB-Printer -m everywhere</code>.`,
}

const activeInstructions = computed(() => instructions[activeTab.value] ?? '')
</script>
