<template>
  <div class="space-y-3">
    <h3 class="font-semibold text-gray-900">
      System Prerequisites
    </h3>
    <p class="text-sm text-gray-500">
      Checking your environment before proceeding.
    </p>
    <div class="space-y-2">
      <div
        v-for="check in checks"
        :key="check.id"
        class="flex items-center gap-3 p-3 rounded-xl border"
        :class="checkBorder(check.state)"
      >
        <div class="flex-shrink-0">
          <CheckCircleIcon
            v-if="check.state === 'ok'"
            class="w-5 h-5 text-green-500"
          />
          <XCircleIcon
            v-else-if="check.state === 'error'"
            class="w-5 h-5 text-red-500"
          />
          <Loader2Icon
            v-else
            class="w-5 h-5 text-gray-400 animate-spin"
          />
        </div>
        <div>
          <p class="text-sm font-medium text-gray-900">
            {{ check.label }}
          </p>
          <p
            v-if="check.detail"
            class="text-xs text-gray-500"
          >
            {{ check.detail }}
          </p>
        </div>
      </div>
    </div>
    <p
      v-if="hasError"
      class="text-xs text-red-600"
    >
      Fix the errors above before continuing. Some issues can be resolved by re-running after fixing Docker permissions.
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { CheckCircleIcon, XCircleIcon, Loader2Icon } from 'lucide-vue-next'

type CheckState = 'pending' | 'ok' | 'error'

interface Check {
  id:     string
  label:  string
  detail: string
  state:  CheckState
}

const emit = defineEmits<{ (e: 'valid', v: boolean): void }>()

const checks = ref<Check[]>([
  { id: 'health',  label: 'Portal server reachable',  detail: '', state: 'pending' },
  { id: 'docker',  label: 'Docker socket available',  detail: '', state: 'pending' },
  { id: 'cups',    label: 'CUPS service reachable',    detail: '', state: 'pending' },
  { id: 'scanner', label: 'ScanServJS reachable',       detail: '', state: 'pending' },
])

const hasError = computed(() => checks.value.some(c => c.state === 'error'))

function checkBorder(state: CheckState) {
  return { ok: 'border-green-100 bg-green-50', error: 'border-red-100 bg-red-50', pending: 'border-gray-100' }[state]
}

onMounted(async () => {
  try {
    const r = await fetch('/api/v1/health')
    const data = await r.json()
    updateCheck('health', 'ok', 'Connected')
    const svcs = data.services ?? {}
    updateCheck('docker',  'ok', 'Portal running')
    updateCheck('cups',    svcs.cups?.status     === 'ok' ? 'ok' : 'error', svcs.cups?.message    ?? '')
    updateCheck('scanner', svcs.scanservjs?.status === 'ok' ? 'ok' : 'error', svcs.scanservjs?.message ?? '')
  } catch {
    for (const c of checks.value) { c.state = 'error'; c.detail = 'Could not reach portal API' }
  }
  emit('valid', !hasError.value)
})

function updateCheck(id: string, state: CheckState, detail: string) {
  const c = checks.value.find(x => x.id === id)
  if (c) { c.state = state; c.detail = detail }
  emit('valid', !hasError.value)
}
</script>
