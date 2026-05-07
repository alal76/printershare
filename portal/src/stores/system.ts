import { defineStore } from 'pinia'
import { ref } from 'vue'

interface ServiceHealth {
  status: 'ok' | 'error' | 'offline' | 'unknown'
  message?: string
}

interface HealthData {
  status: string
  services: Record<string, ServiceHealth>
  timestamp: string
}

export const useSystemStore = defineStore('system', () => {
  const health         = ref<HealthData | null>(null)
  const wizardCompleted = ref<boolean | null>(null)
  const pollInterval   = ref<ReturnType<typeof setInterval> | null>(null)

  async function fetchHealth() {
    try {
      const r = await fetch('/api/v1/health')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      health.value = await r.json() as HealthData
    } catch { /* silent */ }
  }

  async function ensureWizardChecked() {
    if (wizardCompleted.value !== null) return
    try {
      const r = await fetch('/api/v1/wizard/state')
      const data = await r.json()
      wizardCompleted.value = Boolean(data.completed)
    } catch {
      wizardCompleted.value = false
    }
  }

  function startPolling(intervalMs = 30_000) {
    fetchHealth()
    if (pollInterval.value) clearInterval(pollInterval.value)
    pollInterval.value = setInterval(fetchHealth, intervalMs)
  }

  function stopPolling() {
    if (pollInterval.value) {
      clearInterval(pollInterval.value)
      pollInterval.value = null
    }
  }

  return { health, wizardCompleted, fetchHealth, ensureWizardChecked, startPolling, stopPolling }
})
