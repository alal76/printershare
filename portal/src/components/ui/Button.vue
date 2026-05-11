<!-- Beta test version v1.2.0 -->
<template>
  <button
    type="button"
    v-bind="$attrs"
    :class="[variantClass, sizeClass, 'btn']"
    :disabled="disabled || loading"
  >
    <Loader2Icon
      v-if="loading"
      class="w-4 h-4 animate-spin"
    />
    <slot
      v-else-if="$slots.icon"
      name="icon"
    ></slot>
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Loader2Icon } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?:    'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
}>(), { variant: 'primary', size: 'md', loading: false, disabled: false })

const variantClass = computed(() => ({
  primary:   'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
  secondary: 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50',
  ghost:     'text-gray-600 hover:bg-gray-100',
  danger:    'bg-red-600 text-white hover:bg-red-700',
}[props.variant]))

const sizeClass = computed(() => ({
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2.5',
}[props.size]))
</script>
