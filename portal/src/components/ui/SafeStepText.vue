<template>
  <!--
    Renders a step-instruction string that may contain a limited set of
    markup tags (<b>, <code>, <br>). All other tags are stripped before
    rendering so this component is safe even if the step strings ever
    come from an external source.
  -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <span v-html="sanitized"></span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ text: string }>()

// Only allow the specific tags used by printingSteps — strip everything else.
const ALLOWED_TAG = /^\/?(b|code|br)$/i

const sanitized = computed(() => {
  // Split on HTML tags (capturing group keeps them in the array), then
  // reconstruct with only the allowed subset — no global-regex replace needed.
  return props.text.split(/(<[^>]+>)/g).map((token: string) => {
    if (!token.startsWith('<')) return token
    const tag = token.slice(1, -1).trim().replace(/\s.*$/, '')
    return ALLOWED_TAG.test(tag) ? token : ''
  }).join('')
})
</script>
