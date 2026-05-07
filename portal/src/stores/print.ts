import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface PrintJob {
  id:      string
  name:    string
  state:   string
  created: string
}

async function printFile(file: File, printer = 'default') {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('printer', printer)
  const r = await fetch('/api/v1/printer/print', { method: 'POST', body: fd })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
    throw new Error(err.error ?? 'Print failed')
  }
  return r.json()
}

export const usePrintStore = defineStore('print', () => {
  const jobs        = ref<PrintJob[]>([])
  const printerState = ref<'ok' | 'error' | 'offline' | 'unknown'>('unknown')
  const isLoading   = ref(false)

  async function fetchQueue() {
    isLoading.value = true
    try {
      const r = await fetch('/api/v1/printer/queue')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      printerState.value = data.status ?? 'unknown'
      jobs.value = data.jobs ?? []
    } finally {
      isLoading.value = false
    }
  }

  return { jobs, printerState, isLoading, fetchQueue, printFile }
})
