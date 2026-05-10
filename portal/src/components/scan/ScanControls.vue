<template>
  <AppShell title="Scan">
    <div class="max-w-2xl space-y-5">
      <!-- Scan form -->
      <Card>
        <h2 class="text-sm font-semibold text-gray-900 mb-4">
          Scan Settings
        </h2>
        <form
          class="space-y-3"
          @submit.prevent="startScan"
        >
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label
                for="scan-res"
                class="block text-xs font-medium text-gray-700 mb-1"
              >Resolution</label>
              <select
                id="scan-res"
                v-model="opts.resolution"
                class="w-full rounded-xl border-gray-200 text-sm"
              >
                <option value="150">
                  150 dpi
                </option>
                <option value="300">
                  300 dpi
                </option>
                <option value="600">
                  600 dpi
                </option>
              </select>
            </div>
            <div>
              <label
                for="scan-color"
                class="block text-xs font-medium text-gray-700 mb-1"
              >Mode</label>
              <select
                id="scan-color"
                v-model="opts.color"
                class="w-full rounded-xl border-gray-200 text-sm"
              >
                <option value="color">
                  Color
                </option>
                <option value="gray">
                  Grayscale
                </option>
                <option value="lineart">
                  Black & White
                </option>
              </select>
            </div>
            <div>
              <label
                for="scan-format"
                class="block text-xs font-medium text-gray-700 mb-1"
              >Format</label>
              <select
                id="scan-format"
                v-model="opts.format"
                class="w-full rounded-xl border-gray-200 text-sm"
              >
                <option value="pdf">
                  PDF
                </option>
                <option value="jpg">
                  JPEG
                </option>
                <option value="png">
                  PNG
                </option>
                <option value="tiff">
                  TIFF
                </option>
              </select>
            </div>
            <div>
              <label
                for="scan-source"
                class="block text-xs font-medium text-gray-700 mb-1"
              >Source</label>
              <select
                id="scan-source"
                v-model="opts.source"
                class="w-full rounded-xl border-gray-200 text-sm"
              >
                <option value="flatbed">
                  Flatbed
                </option>
                <option value="adf">
                  Auto Feed (ADF)
                </option>
              </select>
            </div>
          </div>
          <Button
            type="submit"
            class="w-full"
            :loading="scanning"
          >
            <ScanIcon class="w-4 h-4" />
            {{ scanning ? 'Scanning…' : 'Start Scan' }}
          </Button>
        </form>
      </Card>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ScanIcon } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import Card     from '@/components/ui/Card.vue'
import Button   from '@/components/ui/Button.vue'
import { useToastStore } from '@/stores/toast'
import { useScanStore }  from '@/stores/scan'

const toast     = useToastStore()
const scanStore = useScanStore()
const scanning  = ref(false)

const opts = ref({ resolution: '300', color: 'color', format: 'pdf', source: 'flatbed' })

async function startScan() {
  scanning.value = true
  try {
    // Map form options to scanservjs's expected values (case-sensitive).
    const modeMap: Record<string, string> = {
      color:   'Color',
      gray:    'Gray',
      lineart: 'Lineart',
    }
    const sourceMap: Record<string, string> = {
      flatbed: 'Flatbed',
      adf:     'ADF',
    }
    const mode   = modeMap[opts.value.color]   ?? 'Color'
    const source = sourceMap[opts.value.source] ?? 'Flatbed'

    // Pick a pipeline name matching the chosen format.  The portal-side
    // /api/v1/scans/run endpoint will fall back to the device's default
    // pipeline if this one isn't recognised.
    const fmt = opts.value.format
    const pipelineByFormat: Record<string, string> = {
      pdf:  'PDF (Searchable, high-quality)',
      jpg:  'JPG | @:pipeline.high-quality',
      png:  'PNG | @:pipeline.high-quality',
      tiff: 'TIF | @:pipeline.high-quality',
    }
    const pipeline = pipelineByFormat[fmt]

    // POST through the portal so CUPS releases the USB interface while
    // SANE scans, then reclaims it afterwards.  Device discovery happens
    // server-side under the same lock.
    const r = await fetch('/api/v1/scans/run', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        params: {
          resolution: Number(opts.value.resolution),
          mode,
          source,
        },
        pipeline,
        filters: [],
        batch:   'none',
        index:   1,
      }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      const detail = text ? ` — ${text.slice(0, 200)}` : ''
      throw new Error(`Scan failed: HTTP ${r.status}${detail}`)
    }
    toast.success('Scan complete', 'File saved to scan folder.')
    await scanStore.fetchFiles()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    toast.error('Scan failed', msg)
  } finally {
    scanning.value = false
  }
}
</script>
