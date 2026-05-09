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
  { id: 'health',  label: 'Portal server reachable',   detail: '', state: 'pending' },
  { id: 'docker',  label: 'Docker socket available',   detail: '', state: 'pending' },
  { id: 'compose', label: 'Docker Compose plugin',     detail: '', state: 'pending' },
  { id: 'cups',    label: 'CUPS service reachable',    detail: '', state: 'pending' },
  { id: 'scanner', label: 'ScanServJS reachable',      detail: '', state: 'pending' },
  { id: 'rclone',  label: 'rclone installed',          detail: '(needed for cloud backup)', state: 'pending' },
])

const hasError = computed(() => checks.value.some(c => c.state === 'error'))

function checkBorder(state: CheckState) {
  return { ok: 'border-green-100 bg-green-50', error: 'border-red-100 bg-red-50', pending: 'border-gray-100' }[state]
}

onMounted(async () => {
  try {
    // Health + service checks
    const r = await fetch('/api/v1/health')
    const data = await r.json()
    updateCheck('health', 'ok', 'Connected')
    updateCheck('docker', 'ok', 'Portal running')
    const svcs = data.services ?? {}
    updateCheck('cups',    svcs.cups?.status      === 'ok' ? 'ok' : 'error', svcs.cups?.message     ?? '')
    updateCheck('scanner', svcs.scanservjs?.status === 'ok' ? 'ok' : 'error', svcs.scanservjs?.message ?? '')
  } catch {
    for (const c of checks.value) { c.state = 'error'; c.detail = 'Could not reach portal API' }
    emit('valid', false)
    return
  }

  // Tool availability checks (docker compose + rclone)
  try {
    const r2 = await fetch('/api/v1/wizard/prereqs')
    const tools = await r2.json() as Record<string, { ok: boolean; detail?: string }>
    updateCheck('compose', tools.dockerCompose?.ok ? 'ok' : 'error', tools.dockerCompose?.detail ?? '')
    // rclone is optional (warn only, don't block)
    if (tools.rclone?.ok) {
      updateCheck('rclone', 'ok', tools.rclone.detail ?? 'installed')
    } else {
      const c = checks.value.find(x => x.id === 'rclone')
      if (c) { c.state = 'error'; c.detail = 'Not found — will be missing from the portal container (rebuild required)' }
    }
  } catch {
    updateCheck('compose', 'error', 'Could not reach prereqs API')
    updateCheck('rclone',  'error', 'Could not reach prereqs API')
  }

  // rclone missing blocks wizard only if the compose check also fails; otherwise warn
  const blockingError = checks.value.some(c => c.state === 'error' && c.id !== 'rclone')
  emit('valid', !blockingError)
})

function updateCheck(id: string, state: CheckState, detail: string) {
  const c = checks.value.find(x => x.id === id)
  if (c) { c.state = state; c.detail = detail }
}
</script>
