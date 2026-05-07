import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ScanFile {
  name:     string
  size:     number
  date:     string
  mimeType: string
  url:      string
}

export const useScanStore = defineStore('scan', () => {
  const files     = ref<ScanFile[]>([])
  const isLoading = ref(false)

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

  async function deleteFile(name: string) {
    await fetch(`/api/v1/scans/${encodeURIComponent(name)}`, { method: 'DELETE' })
    files.value = files.value.filter(f => f.name !== name)
  }

  return { files, isLoading, fetchFiles, deleteFile }
})
