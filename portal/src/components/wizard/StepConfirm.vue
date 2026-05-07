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
      v-if="logs.length > 0"
      class="bg-black rounded-xl p-4 max-h-64 overflow-y-auto"
    >
      <p
        v-for="(l, i) in logs"
        :key="i"
        class="text-xs text-green-400 font-mono whitespace-pre-wrap"
      >
        {{ l }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

const props = defineProps<{ config: Record<string, string> }>()
const emit  = defineEmits<{ (e: 'valid', v: boolean): void }>()

const logs = ref<string[]>([])

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
