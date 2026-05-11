<!-- Beta test version v1.2.0 -->
<template>
  <div
    class="bg-white rounded-2xl shadow-sm border border-gray-100"
    :class="[padding ? 'p-5' : '', $attrs.class]"
  >
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ padding?: boolean }>(), { padding: true })
</script>
