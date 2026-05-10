import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ScanFile {
  name:     string
  size:     number
  date:     string
  mimeType: string
  url:      string
}

export interface ScannerSettings {
  pipeline:  { options: string[]; default: string }
  batchMode: { options: string[]; default: string }
  filters:   { options: string[]; default: string[] }
}

export interface ScannerDevice {
  id:       string
  name:     string
  features: Record<string, { options?: (string | number)[]; default?: string | number }>
  settings: ScannerSettings
}

export const useScanStore = defineStore('scan', () => {
  const files     = ref<ScanFile[]>([])
  const isLoading = ref(false)
  const context   = ref<{ device: ScannerDevice | null } | null>(null)

  async function fetchFiles() {
    isLoading.value = true
    try {
      const r = await fetch('/api/v1/scans')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      files.value = data.files ?? []
    } finally {
      isLoading.value = false
    }
  }

  async function fetchContext() {
    try {
      const r = await fetch('/api/v1/scans/context')
      if (!r.ok) return
      context.value = await r.json()
    } catch {
      // best effort — UI degrades gracefully without context
    }
  }

  async function deleteFile(name: string) {
    await fetch(`/api/v1/scans/${encodeURIComponent(name)}`, { method: 'DELETE' })
    files.value = files.value.filter(f => f.name !== name)
  }

  return { files, isLoading, context, fetchFiles, fetchContext, deleteFile }
})
