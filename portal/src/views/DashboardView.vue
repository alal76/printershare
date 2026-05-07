<template>
  <AppShell title="Dashboard">
    <!-- Service status grid -->
    <section class="mb-6">
      <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Services</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <Card v-for="(svc, name) in services" :key="name">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium text-gray-600 capitalize">{{ name }}</span>
            <StatusBadge :status="mapStatus(svc.status)" />
          </div>
          <p v-if="svc.message" class="text-xs text-gray-400 truncate">{{ svc.message }}</p>
        </Card>
      </div>
    </section>

    <!-- Quick actions -->
    <section class="mb-6">
      <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Quick Actions</h2>
      <div class="flex flex-wrap gap-3">
        <Button @click="$router.push('/scan')"><ScanIcon class="w-4 h-4" />New Scan</Button>
        <Button variant="secondary" @click="$router.push('/print')"><PrinterIcon class="w-4 h-4" />Print File</Button>
        <Button variant="secondary" @click="$router.push('/docs')"><FileTextIcon class="w-4 h-4" />View Documents</Button>
      </div>
    </section>

    <!-- Recent scans -->
    <section>
      <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Scans</h2>
      <FileList :max="5" />
    </section>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ScanIcon, PrinterIcon, FileTextIcon } from 'lucide-vue-next'
import AppShell   from '@/components/layout/AppShell.vue'
import Card       from '@/components/ui/Card.vue'
import Button     from '@/components/ui/Button.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import FileList   from '@/components/scan/FileList.vue'
import { useSystemStore } from '@/stores/system'

type SvcStatus = 'ok' | 'warning' | 'error' | 'pending' | 'offline' | 'unknown'

const system   = useSystemStore()
const services = computed(() => system.health?.services ?? {})

function mapStatus(s: string): SvcStatus {
  const map: Record<string, SvcStatus> = { ok: 'ok', error: 'error', offline: 'offline' }
  return map[s] ?? 'unknown'
}

onMounted(() => system.startPolling())
</script>
