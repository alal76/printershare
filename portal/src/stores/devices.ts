// Beta test version v1.2.0
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
  name:         string
  state:        'idle' | 'busy' | 'disabled' | 'unknown'
  uri:          string
  accepting:    boolean
  stateReasons: string[]
  statusMsg:    string
  location:     string
  info:         string
  jobCount:     number
  default:      boolean
}

export type PrinterAction = 'enable' | 'disable' | 'accept' | 'reject' | 'cancel-jobs' | 'resume'

export interface PrinterOption {
  key:     string
  label:   string
  current: string | null
  values:  { value: string; label: string; current: boolean }[]
}

export interface SaneScanner {
  device:  string
  vendor:  string
  model:   string
  type:    string
  default: boolean
}

export interface NetworkScanner {
  name:     string
  url:      string
  protocol: string
  disabled: boolean
}

export const useDevicesStore = defineStore('devices', () => {
  const usb            = ref<UsbDevice[]>([])
  const printers       = ref<CupsPrinter[]>([])
  const scanners       = ref<SaneScanner[]>([])
  const networkScanners = ref<NetworkScanner[]>([])
  const loading  = ref(false)
  const error    = ref<string | null>(null)

  async function fetchNetworkScanners() {
    try {
      const r = await fetch('/api/v1/devices/scanner/network')
      if (!r.ok) return // native-only feature — silently skip if unavailable
      const data = await r.json() as { scanners: NetworkScanner[] }
      networkScanners.value = data.scanners ?? []
    } catch { /* best-effort — not fatal if unreachable */ }
  }

  async function addNetworkScanner(name: string, url: string, protocol: 'eSCL' | 'WSD'): Promise<void> {
    const r = await fetch('/api/v1/devices/scanner/network', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, url, protocol }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Failed to add network scanner')
    }
    await fetchNetworkScanners()
    await fetchDevices()
  }

  async function removeNetworkScanner(name: string): Promise<void> {
    const r = await fetch(`/api/v1/devices/scanner/network/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Failed to remove network scanner')
    }
    networkScanners.value = networkScanners.value.filter(s => s.name !== name)
  }

  async function fetchDevices() {
    loading.value = true
    error.value   = null
    try {
      const r = await fetch('/api/v1/devices')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      usb.value      = data.usb      ?? []
      printers.value = data.printers ?? []
      scanners.value = data.scanners ?? []
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function addPrinter(name: string, uri: string, driver?: string): Promise<{ driver: string }> {
    const r = await fetch('/api/v1/devices/printer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, uri, driver: driver || undefined }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Failed to add printer')
    }
    const data = await r.json() as { driver: string }
    await fetchDevices()
    return data
  }

  async function uploadPpd(name: string, file: File): Promise<void> {
    const form = new FormData()
    form.append('ppd', file)
    const r = await fetch(`/api/v1/devices/printer/${encodeURIComponent(name)}/ppd`, {
      method: 'POST',
      body:   form,
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Failed to apply PPD')
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

  async function autoAddPrinter(vidpid: string, name?: string): Promise<{ name: string; uri: string }> {
    const r = await fetch('/api/v1/devices/printer/auto-add', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ vidpid, name }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Auto-add failed')
    }
    const data = await r.json() as { name: string; uri: string }
    await fetchDevices()
    return data
  }

  async function resetAll(): Promise<{ removed: string[]; errors: string[] }> {
    const r = await fetch('/api/v1/devices/reset', { method: 'POST' })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Reset failed')
    }
    const data = await r.json() as { removed: string[]; errors: string[] }
    await fetchDevices()
    return data
  }

  async function setDefaultPrinter(name: string): Promise<void> {
    const r = await fetch(`/api/v1/devices/printer/${encodeURIComponent(name)}/default`, {
      method: 'POST',
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Failed to set default printer')
    }
    await fetchDevices()
  }

  async function setDefaultScanner(device: string): Promise<void> {
    const r = await fetch('/api/v1/devices/scanner/default', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ device }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      throw new Error(e.error ?? 'Failed to set default scanner')
    }
    await fetchDevices()
  }

  return {
    usb, printers, scanners, loading, error,
    fetchDevices, addPrinter, autoAddPrinter, removePrinter,
    resetAll, testPrint: testPrintDevice,
    printerAction: printerActionFn,
    fetchPrinterAttributes: fetchPrinterAttributesFn,
    setPrinterOption: setPrinterOptionFn,
    setDefaultPrinter, setDefaultScanner, uploadPpd,
    networkScanners, fetchNetworkScanners, addNetworkScanner, removeNetworkScanner,
  }
})

export interface DriverOption {
  id:          string
  description: string
}

/**
 * Search the installed driver/PPD catalogue (`lpinfo -m` — foomatic-db,
 * gutenprint, hplip). Used to pick a real driver for printers that don't
 * support driverless IPP Everywhere (older network printers, socket://
 * and lpd:// raw queues).
 */
export async function searchDrivers(q: string): Promise<DriverOption[]> {
  const r = await fetch(`/api/v1/devices/drivers?q=${encodeURIComponent(q)}`)
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
    throw new Error((e as { error?: string }).error ?? 'Driver search failed')
  }
  const data = await r.json() as { drivers: DriverOption[] }
  return data.drivers ?? []
}

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

export async function printerActionFn(name: string, action: PrinterAction): Promise<void> {
  const r = await fetch(`/api/v1/devices/printer/${encodeURIComponent(name)}/action`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
    throw new Error((e as { error?: string }).error ?? 'Action failed')
  }
}

export async function fetchPrinterAttributesFn(name: string): Promise<PrinterOption[]> {
  const r = await fetch(`/api/v1/devices/printer/${encodeURIComponent(name)}/attributes`)
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
    throw new Error((e as { error?: string }).error ?? 'Could not load attributes')
  }
  const data = await r.json() as { options?: PrinterOption[] }
  return data.options ?? []
}

export async function setPrinterOptionFn(name: string, key: string, value: string): Promise<void> {
  const r = await fetch(`/api/v1/devices/printer/${encodeURIComponent(name)}/option`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ key, value }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
    throw new Error((e as { error?: string }).error ?? 'Could not set option')
  }
}
