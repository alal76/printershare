<!-- Beta test version v1.2.0 -->
<template>
  <AppShell title="Documents">
    <div class="h-[calc(100vh-8rem)]">
      <iframe
        v-if="paperlessUrl"
        :src="paperlessUrl"
        class="w-full h-full rounded-2xl border border-gray-100"
        title="Paperless-ngx document archive"
        allow="same-origin"
      ></iframe>
      <div
        v-else
        class="flex flex-col items-center justify-center h-full text-center text-gray-400"
      >
        <FileTextIcon class="w-12 h-12 mb-3" />
        <p class="text-sm font-medium text-gray-600">
          Document archive not enabled
        </p>
        <p class="text-xs mt-1">
          Enable <code class="font-mono">docs</code> profile in your compose setup.
        </p>
        <Button
          variant="secondary"
          class="mt-4"
          @click="$router.push('/settings')"
        >
          Go to Settings
        </Button>
      </div>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { FileTextIcon }   from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import Button   from '@/components/ui/Button.vue'

const paperlessUrl = ref('')

onMounted(async () => {
  try {
    const r = await fetch('/api/v1/health')
    const d = await r.json()
    if (d.services?.paperless?.status === 'ok') {
      paperlessUrl.value = '/docs/'
    }
  } catch { /* leave empty */ }
})
</script>
