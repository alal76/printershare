/**
 * Unit tests for the devices Pinia store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDevicesStore, testPrintDevice } from '../../../src/stores/devices'

const MOCK_RESPONSE = {
  usb: [{ bus: '001', device: '003', vid: '03f0', pid: '2b17', vidpid: '03f0:2b17', name: 'HP LaserJet', make: 'HP', model: 'LaserJet', capabilities: { print: true, scan: false, escl: false, fax: false } }],
  printers: [{ name: 'HP-LaserJet', state: 'idle', uri: 'ipp://localhost:631/printers/HP-LaserJet' }],
}

const mockFetch = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

function okResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}
const DEFAULT_ERROR = { error: 'Server error' }
function failResponse(status = 500, body: Record<string, string> = DEFAULT_ERROR) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

describe('fetchDevices', () => {
  it('populates printers and usb lists', async () => {
    mockFetch.mockReturnValueOnce(okResponse(MOCK_RESPONSE))
    const store = useDevicesStore()
    await store.fetchDevices()
    expect(store.printers).toHaveLength(1)
    expect(store.usb).toHaveLength(1)
    expect(store.loading).toBe(false)
  })

  it('sets loading false even on error', async () => {
    mockFetch.mockReturnValueOnce(failResponse())
    const store = useDevicesStore()
    await store.fetchDevices()
    expect(store.loading).toBe(false)
  })
})

describe('addPrinter', () => {
  it('calls POST and refreshes device list', async () => {
    mockFetch
      .mockReturnValueOnce(okResponse({ ok: true }))
      .mockReturnValueOnce(okResponse(MOCK_RESPONSE))
    const store = useDevicesStore()
    await store.addPrinter('HP-Test', 'ipp://192.168.1.10/ipp/print')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws on failure', async () => {
    mockFetch.mockReturnValueOnce(failResponse(400, { error: 'Invalid URI' }))
    const store = useDevicesStore()
    await expect(store.addPrinter('X', 'bad-uri')).rejects.toThrow('Invalid URI')
  })
})

describe('removePrinter', () => {
  it('calls DELETE and removes printer locally', async () => {
    mockFetch.mockReturnValueOnce(okResponse({ ok: true }))
    const store = useDevicesStore()
    // Pre-populate the printers list
    store.printers.push({ name: 'HP-LaserJet', state: 'idle', uri: 'ipp://localhost:631/printers/HP-LaserJet' })
    await store.removePrinter('HP-LaserJet')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(store.printers.find(p => p.name === 'HP-LaserJet')).toBeUndefined()
  })
})

describe('testPrintDevice', () => {
  it('calls the test-print endpoint', async () => {
    mockFetch.mockReturnValueOnce(okResponse({ ok: true }))
    await testPrintDevice('HP-LaserJet')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/devices/printer/HP-LaserJet/test',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockReturnValueOnce(failResponse(500, { error: 'CUPS error' }))
    await expect(testPrintDevice('HP-LaserJet')).rejects.toThrow('CUPS error')
  })
})
