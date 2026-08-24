// Beta test version v1.2.0
import { defineStore } from 'pinia'
import { ref } from 'vue'

interface ServiceHealth {
  status: 'ok' | 'error' | 'offline' | 'unknown' | 'disabled'
  message?: string
  ip?: string
}

interface DiskHealth {
  percentUsed:  number
  availableGb:  number
  status:       'ok' | 'warning' | 'critical'
}

interface HealthData {
  status: string
  services: Record<string, ServiceHealth>
  disk?: DiskHealth | null
  timestamp: string
}

interface SystemInfo {
  hostname: string
  ip: string
  platform: string
  arch: string
  uptime: number
  version: string
}

export const useSystemStore = defineStore('system', () => {
  const health         = ref<HealthData | null>(null)
  const info           = ref<SystemInfo | null>(null)
  const settingsSnapshot = ref<Record<string, string> | null>(null)
  const wizardCompleted = ref<boolean | null>(null)
  const pollInterval   = ref<ReturnType<typeof setInterval> | null>(null)

  async function fetchHealth() {
    try {
      const r = await fetch('/api/v1/health')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      health.value = await r.json() as HealthData
    } catch { /* silent */ }
  }

  async function fetchInfo() {
    try {
      const r = await fetch('/api/v1/system/info')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      info.value = await r.json() as SystemInfo
    } catch { /* silent */ }
  }

  async function fetchSettingsSnapshot() {
    try {
      const r = await fetch('/api/v1/settings')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      settingsSnapshot.value = await r.json() as Record<string, string>
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

  function startPolling(intervalMs = 10_000) {
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

  return {
    health,
    info,
    settingsSnapshot,
    wizardCompleted,
    fetchHealth,
    fetchInfo,
    fetchSettingsSnapshot,
    ensureWizardChecked,
    startPolling,
    stopPolling,
  }
})
