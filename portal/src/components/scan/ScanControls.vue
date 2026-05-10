<template>
  <div class="space-y-4">
    <!-- Format + Resolution -->
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label
          for="scan-format"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Output format</label>
        <select
          id="scan-format"
          v-model="opts.pipelineKey"
          class="w-full rounded-xl border-gray-200 text-sm"
          :disabled="batchState !== 'idle'"
        >
          <optgroup label="PDF">
            <option
              v-for="p in pdfPipelines"
              :key="p.key"
              :value="p.key"
            >
              {{ p.label }}
            </option>
          </optgroup>
          <optgroup label="Image">
            <option
              v-for="p in imgPipelines"
              :key="p.key"
              :value="p.key"
            >
              {{ p.label }}
            </option>
          </optgroup>
          <optgroup label="OCR">
            <option
              v-for="p in ocrPipelines"
              :key="p.key"
              :value="p.key"
            >
              {{ p.label }}
            </option>
          </optgroup>
        </select>
      </div>
      <div>
        <label
          for="scan-res"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Resolution</label>
        <select
          id="scan-res"
          v-model="opts.resolution"
          class="w-full rounded-xl border-gray-200 text-sm"
          :disabled="batchState !== 'idle'"
        >
          <option value="150">
            150 dpi — Draft
          </option>
          <option value="300">
            300 dpi — Standard
          </option>
          <option value="600">
            600 dpi — High
          </option>
          <option value="1200">
            1200 dpi — Archival
          </option>
        </select>
      </div>
    </div>

    <!-- Color mode + Source -->
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label
          for="scan-color"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Color mode</label>
        <select
          id="scan-color"
          v-model="opts.color"
          class="w-full rounded-xl border-gray-200 text-sm"
          :disabled="batchState !== 'idle'"
        >
          <option value="Color">
            Color
          </option>
          <option value="Grayscale">
            Grayscale
          </option>
          <option value="Line Art">
            Black & White
          </option>
        </select>
      </div>
      <div>
        <label
          for="scan-source"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Paper source</label>
        <select
          id="scan-source"
          v-model="opts.source"
          class="w-full rounded-xl border-gray-200 text-sm"
          :disabled="batchState !== 'idle'"
        >
          <option value="Flatbed">
            Flatbed
          </option>
          <option value="ADF">
            Auto Feed (ADF)
          </option>
        </select>
      </div>
    </div>

    <!-- Multi-page toggle (PDF only, idle only) -->
    <div
      v-if="isPdf && batchState === 'idle'"
      class="flex items-center gap-2 py-1"
    >
      <input
        id="multipage"
        v-model="opts.multiPage"
        type="checkbox"
        class="rounded border-gray-300"
      />
      <label
        for="multipage"
        class="text-sm text-gray-700 cursor-pointer select-none"
      >Multi-page document</label>
      <span class="text-xs text-gray-400">
        {{ opts.source === 'ADF' ? '(ADF feeds all pages automatically)' : '(scan one page at a time)' }}
      </span>
    </div>

    <!-- Batch progress panel -->
    <div
      v-if="batchState !== 'idle'"
      class="rounded-xl border border-primary-200 bg-primary-50 p-4 space-y-3"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-primary-800">
          Multi-page PDF — {{ batchPages.length }} page{{ batchPages.length === 1 ? '' : 's' }} scanned
        </span>
        <button
          type="button"
          class="ml-auto text-xs text-gray-400 hover:text-red-500"
          :disabled="batchState === 'scanning' || batchState === 'combining'"
          @click="cancelBatch"
        >
          Cancel
        </button>
      </div>

      <div
        v-if="batchState === 'scanning'"
        class="flex items-center gap-2 text-sm text-primary-700"
      >
        <span class="animate-spin inline-block w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full"></span>
        Scanning page {{ batchPages.length + 1 }}…
      </div>

      <div
        v-if="batchState === 'combining'"
        class="flex items-center gap-2 text-sm text-primary-700"
      >
        <span class="animate-spin inline-block w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full"></span>
        Assembling PDF…
      </div>

      <div
        v-if="batchState === 'awaiting_next'"
        class="flex flex-wrap gap-2"
      >
        <Button
          size="sm"
          :loading="false"
          @click="scanNextPage"
        >
          Scan page {{ batchPages.length + 1 }}
        </Button>
        <Button
          size="sm"
          variant="primary"
          :loading="false"
          @click="finishBatch"
        >
          Finish PDF ({{ batchPages.length }} pages)
        </Button>
      </div>
    </div>

    <!-- Advanced (filters) -->
    <details class="group">
      <summary class="text-xs font-medium text-gray-500 cursor-pointer select-none hover:text-gray-700 list-none flex items-center gap-1">
        <ChevronRightIcon class="w-3 h-3 transition-transform group-open:rotate-90" />
        Advanced options
      </summary>
      <div class="mt-3 space-y-2 pl-1">
        <p class="text-xs font-medium text-gray-600 mb-1">
          Image filters
        </p>
        <label
          v-for="f in availableFilters"
          :key="f.value"
          class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
        >
          <input
            v-model="opts.filters"
            type="checkbox"
            :value="f.value"
            class="rounded border-gray-300"
          />
          {{ f.label }}
        </label>
      </div>
    </details>

    <!-- Primary scan button (idle mode) -->
    <Button
      v-if="batchState === 'idle'"
      type="button"
      class="w-full"
      :loading="false"
      @click="startScan"
    >
      <ScanIcon class="w-4 h-4" />
      {{ opts.multiPage && isPdf && opts.source !== 'ADF' ? 'Scan first page' : 'Scan' }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ScanIcon, ChevronRightIcon } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { useToastStore } from '@/stores/toast'
import { useScanStore }  from '@/stores/scan'

const toast     = useToastStore()
const scanStore = useScanStore()

// ── Pipeline catalogue ────────────────────────────────────────────────────────
interface PipelineChoice {
  key:      string
  label:    string
  pipeline: string
  isPdf:    boolean
}

const PIPELINE_CHOICES: PipelineChoice[] = [
  { key: 'pdf_high',     label: 'PDF — High quality',      pipeline: 'PDF (JPG | @:pipeline.high-quality)',              isPdf: true  },
  { key: 'pdf_med',      label: 'PDF — Medium quality',    pipeline: 'PDF (JPG | @:pipeline.medium-quality)',            isPdf: true  },
  { key: 'pdf_low',      label: 'PDF — Low quality',       pipeline: 'PDF (JPG | @:pipeline.low-quality)',               isPdf: true  },
  { key: 'pdf_lossless', label: 'PDF — Lossless (TIF)',    pipeline: 'PDF (TIF | @:pipeline.lzw-compressed)',            isPdf: true  },
  { key: 'jpg_high',     label: 'JPEG — High quality',     pipeline: 'JPG | @:pipeline.high-quality',                    isPdf: false },
  { key: 'jpg_med',      label: 'JPEG — Medium quality',   pipeline: 'JPG | @:pipeline.medium-quality',                  isPdf: false },
  { key: 'jpg_low',      label: 'JPEG — Low quality',      pipeline: 'JPG | @:pipeline.low-quality',                     isPdf: false },
  { key: 'png',          label: 'PNG',                     pipeline: 'PNG',                                               isPdf: false },
  { key: 'tiff',         label: 'TIFF (compressed)',        pipeline: 'TIF | @:pipeline.lzw-compressed',                  isPdf: false },
  { key: 'ocr_pdf',      label: 'PDF with OCR text',       pipeline: '@:pipeline.ocr | PDF (JPG | @:pipeline.high-quality)', isPdf: true },
  { key: 'ocr_text',     label: 'OCR text file',           pipeline: '@:pipeline.ocr | @:pipeline.text-file',            isPdf: false },
]

// Filter choices to those the device actually supports, or keep all if context unavailable.
const availableChoices = computed<PipelineChoice[]>(() => {
  const deviceOptions = scanStore.context?.device?.settings?.pipeline?.options
  if (!deviceOptions) return PIPELINE_CHOICES
  return PIPELINE_CHOICES.filter(c => deviceOptions.includes(c.pipeline))
})

const pdfPipelines = computed(() => availableChoices.value.filter(c => c.isPdf && !c.key.startsWith('ocr')))
const imgPipelines = computed(() => availableChoices.value.filter(c => !c.isPdf))
const ocrPipelines = computed(() => availableChoices.value.filter(c => c.key.startsWith('ocr')))

// ── Filter catalogue ──────────────────────────────────────────────────────────
const FILTER_LABELS: Record<string, string> = {
  'filter.auto-contrast':  'Auto contrast',
  'filter.auto-level':     'Auto levels',
  'filter.threshold':      'Threshold (B&W)',
  'filter.blur':           'Blur (noise reduction)',
  'filter.more-contrast':  'More contrast',
}

const availableFilters = computed(() => {
  const opts = scanStore.context?.device?.settings?.filters?.options ?? Object.keys(FILTER_LABELS)
  return opts.map((v: string) => ({ value: v, label: FILTER_LABELS[v] ?? v }))
})

// ── Scan options ──────────────────────────────────────────────────────────────
const opts = ref({
  pipelineKey: 'pdf_high',
  resolution:  '300',
  color:       'Color',
  source:      'Flatbed',
  multiPage:   false,
  filters:     [] as string[],
})

const isPdf = computed(() => {
  const choice = PIPELINE_CHOICES.find(c => c.key === opts.value.pipelineKey)
  return choice?.isPdf ?? false
})

const selectedPipeline = computed(() => {
  return PIPELINE_CHOICES.find(c => c.key === opts.value.pipelineKey)?.pipeline ?? ''
})

// ── Multi-page batch state machine ────────────────────────────────────────────
type BatchState = 'idle' | 'scanning' | 'awaiting_next' | 'combining'

const batchState = ref<BatchState>('idle')
const batchPages = ref<string[]>([])  // filenames of scanned pages

async function doScan(): Promise<string> {
  const r = await fetch('/api/v1/scans/run', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      params: {
        resolution: Number(opts.value.resolution),
        mode:       opts.value.color,
        source:     opts.value.source,
      },
      pipeline: selectedPipeline.value,
      filters:  opts.value.filters,
      batch:    'none',
      index:    1,
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    const detail = text ? ` — ${text.slice(0, 200)}` : ''
    throw new Error(`Scan failed: HTTP ${r.status}${detail}`)
  }
  const data = await r.json() as { file?: { name?: string } }
  return data.file?.name ?? ''
}

async function startScan() {
  // ADF auto-batch: single POST, scanservjs handles all pages
  if (opts.value.multiPage && isPdf.value && opts.value.source === 'ADF') {
    await runAdfBatch()
    return
  }
  // Manual multi-page flatbed
  if (opts.value.multiPage && isPdf.value) {
    batchState.value = 'scanning'
    batchPages.value = []
    try {
      const name = await doScan()
      if (name) batchPages.value.push(name)
      await scanStore.fetchFiles()
      batchState.value = 'awaiting_next'
    } catch (err: unknown) {
      batchState.value = 'idle'
      batchPages.value = []
      toast.error('Scan failed', err instanceof Error ? err.message : String(err))
    }
    return
  }
  // Single page
  batchState.value = 'scanning'
  try {
    await doScan()
    toast.success('Scan complete', 'File saved to scan folder.')
    await scanStore.fetchFiles()
  } catch (err: unknown) {
    toast.error('Scan failed', err instanceof Error ? err.message : String(err))
  } finally {
    batchState.value = 'idle'
  }
}

async function scanNextPage() {
  batchState.value = 'scanning'
  try {
    const name = await doScan()
    if (name) batchPages.value.push(name)
    await scanStore.fetchFiles()
    batchState.value = 'awaiting_next'
  } catch (err: unknown) {
    batchState.value = 'awaiting_next'
    toast.error('Scan failed', err instanceof Error ? err.message : String(err))
  }
}

async function finishBatch() {
  if (batchPages.value.length === 0) { cancelBatch(); return }
  batchState.value = 'combining'
  try {
    const outName = `scan-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${batchPages.value.length}p`
    const r = await fetch('/api/v1/scans/combine', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ files: batchPages.value, outputName: outName, deleteAfter: true }),
    })
    if (!r.ok) {
      const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` })) as { error?: string }
      throw new Error(data.error ?? 'Combine failed')
    }
    const result = await r.json() as { name?: string }
    toast.success('PDF created', `${batchPages.value.length} pages → ${result.name ?? 'scan.pdf'}`)
    await scanStore.fetchFiles()
  } catch (err: unknown) {
    toast.error('Combine failed', err instanceof Error ? err.message : String(err))
  } finally {
    batchState.value = 'idle'
    batchPages.value = []
  }
}

function cancelBatch() {
  batchState.value = 'idle'
  batchPages.value = []
  scanStore.fetchFiles()
}

async function runAdfBatch() {
  batchState.value = 'scanning'
  try {
    const r = await fetch('/api/v1/scans/run', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        params: {
          resolution: Number(opts.value.resolution),
          mode:       opts.value.color,
          source:     'ADF',
        },
        pipeline: selectedPipeline.value,
        filters:  opts.value.filters,
        batch:    'auto',
        index:    1,
      }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      const detail = text ? ` — ${text.slice(0, 200)}` : ''
      throw new Error(`Scan failed: HTTP ${r.status}${detail}`)
    }
    toast.success('ADF scan complete', 'All pages saved.')
    await scanStore.fetchFiles()
  } catch (err: unknown) {
    toast.error('Scan failed', err instanceof Error ? err.message : String(err))
  } finally {
    batchState.value = 'idle'
  }
}

onMounted(() => scanStore.fetchContext())
</script>

