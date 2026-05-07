<template>
  <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium" :class="cls">
    <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :class="dotCls" />
    {{ label ?? statusLabel }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Status = 'ok' | 'warning' | 'error' | 'pending' | 'offline' | 'unknown'

const props = withDefaults(defineProps<{
  status: Status
  label?: string
}>(), { status: 'unknown' })

const config: Record<Status, { bg: string; dot: string; text: string }> = {
  ok:      { bg: 'bg-green-50',  dot: 'bg-green-500',  text: 'Online' },
  warning: { bg: 'bg-yellow-50', dot: 'bg-yellow-400',  text: 'Warning' },
  error:   { bg: 'bg-red-50',    dot: 'bg-red-500',    text: 'Error' },
  pending: { bg: 'bg-blue-50',   dot: 'bg-blue-400 animate-pulse', text: 'Starting' },
  offline: { bg: 'bg-gray-100',  dot: 'bg-gray-400',   text: 'Offline' },
  unknown: { bg: 'bg-gray-100',  dot: 'bg-gray-300',   text: 'Unknown' },
}

const cls        = computed(() => config[props.status]?.bg ?? config.unknown.bg)
const dotCls     = computed(() => config[props.status]?.dot ?? config.unknown.dot)
const statusLabel = computed(() => config[props.status]?.text ?? 'Unknown')
</script>
