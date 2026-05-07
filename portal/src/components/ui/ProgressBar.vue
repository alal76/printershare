<template>
  <div class="w-full">
    <div
      v-if="label || showValue"
      class="flex items-center justify-between mb-1"
    >
      <span
        v-if="label"
        class="text-xs font-medium text-gray-600"
      >{{ label }}</span>
      <span
        v-if="showValue"
        class="text-xs font-medium text-gray-500"
      >{{ value }}%</span>
    </div>
    <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
      <progress
        class="sr-only"
        :value="indeterminate ? undefined : value"
        max="100"
        :aria-label="label ?? 'Progress'"
      ></progress>
      <div
        aria-hidden="true"
        class="h-full rounded-full transition-all duration-500"
        :class="[colorClass, indeterminate ? 'animate-shimmer w-1/2' : '']"
        :style="indeterminate ? {} : { width: `${value}%` }"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  value?:         number
  label?:         string
  showValue?:     boolean
  indeterminate?: boolean
  color?:         'primary' | 'green' | 'yellow' | 'red'
}>(), { value: 0, label: '', showValue: false, indeterminate: false, color: 'primary' })

const colorClass = computed(() => ({
  primary: 'bg-primary-600',
  green:   'bg-green-500',
  yellow:  'bg-yellow-400',
  red:     'bg-red-500',
}[props.color]))
</script>
