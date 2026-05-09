<template>
  <div class="space-y-4">
    <h3 class="font-semibold text-gray-900">
      Review & Build
    </h3>
    <p class="text-sm text-gray-500">
      Review your configuration below, then click Launch to build and start all services.
    </p>

    <div class="bg-gray-50 rounded-xl p-4 text-xs font-mono space-y-1 max-h-48 overflow-y-auto">
      <div
        v-for="(val, key) in displayConfig"
        :key="key"
        class="flex gap-2"
      >
        <span class="text-gray-500 flex-shrink-0 w-44 truncate">{{ key }}</span>
        <span class="text-gray-900 truncate">{{ val }}</span>
      </div>
    </div>

    <!-- Build log stream (shown during build) -->
    <div
      v-if="buildLogs.length > 0"
      ref="logPanel"
      class="bg-black rounded-xl p-4 max-h-64 overflow-y-auto"
    >
      <p
        v-for="(l, i) in buildLogs"
        :key="i"
        class="text-xs font-mono whitespace-pre-wrap"
        :class="l.startsWith('ERROR') ? 'text-red-400' : 'text-green-400'"
      >
        {{ l }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'

const props = defineProps<{
  config: Record<string, string>
  buildLogs?: string[]
}>()
const emit  = defineEmits<{ (e: 'valid', v: boolean): void }>()

const logPanel = ref<HTMLElement | null>(null)
const buildLogs = computed(() => props.buildLogs ?? [])

watch(buildLogs, async () => {
  await nextTick()
  if (logPanel.value) {
    logPanel.value.scrollTop = logPanel.value.scrollHeight
  }
}, { deep: true })

const REDACT = new Set(['SAMBA_PASS', 'PORTAL_SECRET', 'TAILSCALE_AUTH_KEY', 'CLOUDFLARE_TUNNEL_TOKEN'])

const displayConfig = computed(() => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(props.config)) {
    out[k] = REDACT.has(k) ? '••••••••' : (v || '(empty)')
  }
  return out
})

onMounted(() => emit('valid', true))
</script>
