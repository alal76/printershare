// Beta test version v1.2.0
import type { CupsPrinter } from '@/stores/devices'

export type SvcStatus = 'ok' | 'warning' | 'error' | 'pending' | 'offline' | 'unknown'

/**
 * Shared printer-status logic — used by both the Devices page's printer
 * cards and the Dashboard's device inventory, so "what does 'error' mean
 * for a printer" is defined in exactly one place.
 */
export function usePrinterStatus() {
  function printerStatus(p: CupsPrinter): SvcStatus {
    if (p.stateReasons.some(r => /media.empty|jam|toner.empty|ink.empty|cover.open|door.open/i.test(r))) return 'error'
    if (p.stateReasons.some(r => /media.low|toner.low|ink.low/i.test(r))) return 'warning'
    if (p.state === 'idle')     return 'ok'
    if (p.state === 'busy')     return 'pending'
    if (p.state === 'disabled') return 'offline'
    return 'unknown'
  }

  function printerLabel(p: CupsPrinter): string {
    if (p.statusMsg) return p.statusMsg
    if (p.state === 'disabled') return 'Paused'
    return p.state
  }

  function printerIconBg(p: CupsPrinter) {
    const s = printerStatus(p)
    if (s === 'error')   return 'bg-red-50'
    if (s === 'warning') return 'bg-amber-50'
    if (p.state === 'idle')     return 'bg-green-50'
    if (p.state === 'busy')     return 'bg-blue-50'
    if (p.state === 'disabled') return 'bg-gray-100'
    return 'bg-gray-100'
  }

  function printerIconColor(p: CupsPrinter) {
    const s = printerStatus(p)
    if (s === 'error')   return 'text-red-500'
    if (s === 'warning') return 'text-amber-500'
    if (p.state === 'idle')     return 'text-green-600'
    if (p.state === 'busy')     return 'text-blue-600'
    if (p.state === 'disabled') return 'text-gray-400'
    return 'text-gray-400'
  }

  /**
   * "Driverless printers" (added via `-m everywhere`) never have a bound
   * PPD and that's expected — not every driverless queue is broken. What
   * matters is whether a *usb://* queue has no driver: that's the
   * raw/status-blind state a Samsung ULD printer got silently stuck in on
   * a real deployment (see devices.js's printerHasDriver()).
   */
  function driverConcerning(p: CupsPrinter): boolean {
    return !p.hasDriver && p.uri.startsWith('usb://')
  }

  return { printerStatus, printerLabel, printerIconBg, printerIconColor, driverConcerning }
}
