import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface UsbDevice {
  bus:          string
  device:       string
  vid:          string
  pid:          string
  vidpid:       string
  name:         string
  make:         string
  model:        string
  capabilities: {
    print: boolean
    scan:  boolean
    fax:   boolean
    escl:  boolean
  }
}

export interface CupsPrinter {
  name:  string
  state: 'idle' | 'busy' | 'disabled' | 'unknown'
  uri:   string
}

export const useDevicesStore = defineStore('devices', () => {
  const usb      = ref<UsbDevice[]>([])
  const printers = ref<CupsPrinter[]>([])
  const loading  = ref(false)
  const error    = ref<string | null>(null)

  async function fetchDevices() {
    loading.value = true
    error.value   = null
    try {
      const r = await fetch('/api/v1/devices')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      usb.value      = data.usb      ?? []
      printers.value = data.printers ?? []
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function addPrinter(name: string, uri: string): Promise<void> {
    const r = await fetch('/api/v1/devices/printer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, uri }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Failed to add printer')
    }
    await fetchDevices()
  }

  async function removePrinter(name: string): Promise<void> {
    const r = await fetch(`/api/v1/devices/printer/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Failed to remove printer')
    }
    printers.value = printers.value.filter(p => p.name !== name)
  }

  return { usb, printers, loading, error, fetchDevices, addPrinter, removePrinter, testPrint: testPrintDevice }
})

/**
 * Send a test page to the named printer.
 * Defined outside the store to satisfy the lint rule "prefer-top-level-await".
 */
export async function testPrintDevice(name: string): Promise<string> {
  const r = await fetch(`/api/v1/devices/printer/${encodeURIComponent(name)}/test`, {
    method: 'POST',
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
    throw new Error((e as { error?: string }).error ?? 'Test print failed')
  }
  const data = await r.json() as { message?: string }
  return data.message ?? 'Test page sent'
}
