<template>
  <AppShell title="Scan">
    <div class="max-w-2xl space-y-6">
      <!-- Controls -->
      <Card>
        <ScanControls />
      </Card>

      <!-- File list -->
      <section>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Scanned Files
          </h2>
          <Button
            variant="ghost"
            size="sm"
            @click="scanStore.fetchFiles()"
          >
            <RefreshCwIcon class="w-3.5 h-3.5" />
          </Button>
        </div>
        <FileList />
      </section>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted }     from 'vue'
import { RefreshCwIcon } from 'lucide-vue-next'
import AppShell  from '@/components/layout/AppShell.vue'
import Card      from '@/components/ui/Card.vue'
import Button    from '@/components/ui/Button.vue'
import ScanControls from '@/components/scan/ScanControls.vue'
import FileList  from '@/components/scan/FileList.vue'
import { useScanStore }  from '@/stores/scan'

const scanStore = useScanStore()
onMounted(() => scanStore.fetchFiles())
</script>
