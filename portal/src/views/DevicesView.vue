<!-- Beta test version v1.2.0 -->
<template>
  <AppShell title="Devices">
    <div class="max-w-3xl space-y-6">
      <!-- Refresh / Reset buttons -->
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <p class="text-sm text-gray-500">
          Manage connected printers and scanners. USB devices are detected
          automatically; network printers can be added via IPP.
        </p>
        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            :loading="resetting"
            @click="onReset"
          >
            <RotateCcwIcon class="w-3.5 h-3.5" />
            Reset Detection
          </Button>
          <Button
            variant="secondary"
            size="sm"
            :loading="devices.loading"
            @click="devices.fetchDevices()"
          >
            <RefreshCwIcon class="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <!-- ── CUPS Printers ──────────────────────────────────────────────── -->
      <section>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <PrinterIcon class="w-4 h-4 text-primary-600" />
            Printers
            <span class="text-xs font-normal text-gray-400">(via CUPS)</span>
          </h2>
          <Button
            variant="ghost"
            size="sm"
            @click="showAddPrinter = true"
          >
            <PlusIcon class="w-3.5 h-3.5" />
            Add Network Printer
          </Button>
        </div>

        <!-- Empty state -->
        <div
          v-if="devices.printers.length === 0 && !devices.loading"
          class="flex flex-col items-center py-10 border-2 border-dashed border-gray-200 rounded-2xl text-center"
        >
          <PrinterIcon class="w-10 h-10 text-gray-200 mb-3" />
          <p class="text-sm font-medium text-gray-600 mb-1">
            No printers found
          </p>
          <p class="text-xs text-gray-400 mb-4">
            Connect a USB printer or add one via its IPP address
          </p>
          <Button
            size="sm"
            @click="showAddPrinter = true"
          >
            <PlusIcon class="w-3.5 h-3.5" />
            Add a Printer
          </Button>
        </div>

        <!-- Printer cards -->
        <div class="grid gap-3">
          <Card
            v-for="p in devices.printers"
            :key="p.name"
            :padding="false"
          >
            <!-- Main row -->
            <div class="flex items-center gap-4 p-4">
              <!-- Status icon -->
              <div
                class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                :class="printerIconBg(p)"
              >
                <PrinterIcon
                  class="w-5 h-5"
                  :class="printerIconColor(p)"
                />
              </div>

              <!-- Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-semibold text-gray-900 truncate">{{ p.name }}</span>
                  <StatusBadge
                    :status="printerStatus(p)"
                    :label="printerLabel(p)"
                  />
                  <span
                    v-if="p.jobCount > 0"
                    class="text-xs text-blue-600 font-medium"
                  >{{ p.jobCount }} job{{ p.jobCount !== 1 ? 's' : '' }}</span>
                </div>
                <p
                  v-if="p.statusMsg"
                  class="text-xs text-amber-600 font-medium mt-0.5"
                >
                  ⚠ {{ p.statusMsg }}
                </p>
                <p
                  v-else
                  class="text-xs text-gray-400 truncate mt-0.5"
                >
                  {{ p.info || p.uri || 'No URI' }}
                </p>
              </div>

              <!-- Actions -->
              <div class="flex items-center gap-1 flex-shrink-0">
                <!-- Resume / enable button when paused or disabled -->
                <Button
                  v-if="p.state === 'disabled' || p.stateReasons.some(r => r.includes('paused'))"
                  variant="primary"
                  size="sm"
                  :loading="actionLoading === p.name + ':resume'"
                  title="Resume printing"
                  @click="onPrinterAction(p.name, 'resume')"
                >
                  <PlayIcon class="w-3.5 h-3.5" />
                  Resume
                </Button>
                <!-- Pause button when idle/busy -->
                <Button
                  v-else-if="p.state === 'idle' || p.state === 'busy'"
                  variant="ghost"
                  size="sm"
                  :loading="actionLoading === p.name + ':disable'"
                  title="Pause printing"
                  @click="onPrinterAction(p.name, 'disable')"
                >
                  <PauseIcon class="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  :loading="testingPrinter === p.name"
                  @click="onTestPrint(p.name)"
                >
                  <FileCheckIcon class="w-3.5 h-3.5" />
                  Test
                </Button>
                <!-- Settings gear -->
                <button
                  type="button"
                  class="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                  title="Printer settings"
                  @click="openPrinterSettings(p.name)"
                >
                  <SettingsIcon class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Remove printer"
                  @click="onRemovePrinter(p.name)"
                >
                  <Trash2Icon class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Expanded state reasons (paper out etc.) -->
            <div
              v-if="p.stateReasons.length > 0 || !p.accepting"
              class="border-t border-gray-100 px-4 py-2 flex items-center gap-4 bg-amber-50 rounded-b-2xl"
            >
              <span class="text-xs text-amber-700 flex-1">
                <span
                  v-if="!p.accepting"
                  class="mr-3"
                >⊘ Not accepting jobs</span>
                <span
                  v-for="r in p.stateReasons"
                  :key="r"
                  class="mr-2 inline-block"
                >{{ r }}</span>
              </span>
              <div class="flex gap-2">
                <button
                  v-if="!p.accepting"
                  type="button"
                  class="text-xs text-blue-600 hover:underline"
                  @click="onPrinterAction(p.name, 'accept')"
                >
                  Accept jobs
                </button>
                <button
                  v-if="p.jobCount > 0"
                  type="button"
                  class="text-xs text-red-600 hover:underline"
                  @click="onPrinterAction(p.name, 'cancel-jobs')"
                >
                  Cancel all jobs
                </button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <!-- ── SANE Scanners ──────────────────────────────────────────────── -->
      <section>
        <h2 class="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <ScanIcon class="w-4 h-4 text-primary-600" />
          Scanners
          <span class="text-xs font-normal text-gray-400">(via SANE)</span>
        </h2>

        <div
          v-if="devices.scanners.length === 0 && !devices.loading"
          class="flex flex-col items-center py-8 border-2 border-dashed border-gray-200 rounded-2xl text-center"
        >
          <ScanIcon class="w-8 h-8 text-gray-200 mb-2" />
          <p class="text-sm text-gray-500">
            No scanners detected
          </p>
          <p class="text-xs text-gray-400 mt-1 max-w-md">
            Plug in a scanner or MFP. Some models need a vendor SANE backend
            (e.g. <code>libsane-hpaio</code>) — see the Setup wizard.
          </p>
        </div>

        <div class="grid gap-3">
          <Card
            v-for="s in devices.scanners"
            :key="s.device"
            :padding="false"
            :data-testid="`scanner-${s.device}`"
          >
            <div class="flex items-center gap-4 p-4">
              <div class="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                <ScanIcon class="w-5 h-5 text-green-600" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-gray-900 truncate">
                  {{ s.vendor }} {{ s.model }}
                </p>
                <p class="text-xs text-gray-400 truncate mt-0.5">
                  {{ s.device }} · {{ s.type }}
                </p>
              </div>
              <RouterLink
                to="/scan"
                class="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                Scan →
              </RouterLink>
            </div>
          </Card>
        </div>
      </section>

      <!-- ── USB Devices ────────────────────────────────────────────────── -->
      <section>
        <h2 class="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <UsbIcon class="w-4 h-4 text-primary-600" />
          Connected USB Devices
        </h2>

        <div
          v-if="devices.usb.length === 0 && !devices.loading"
          class="flex flex-col items-center py-8 border-2 border-dashed border-gray-200 rounded-2xl text-center"
        >
          <UsbIcon class="w-8 h-8 text-gray-200 mb-2" />
          <p class="text-sm text-gray-500">
            No USB devices detected
          </p>
          <p class="text-xs text-gray-400 mt-1">
            Plug in a printer or scanner and click Refresh
          </p>
        </div>

        <div class="grid gap-3">
          <Card
            v-for="d in devices.usb"
            :key="d.vidpid"
            :padding="false"
            :data-testid="`usb-device-${d.vidpid.replace(':', '-')}`"
          >
            <div class="flex items-center gap-4 p-4">
              <!-- Device icon -->
              <div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                <ScanIcon
                  v-if="d.capabilities.scan && !d.capabilities.print"
                  class="w-5 h-5 text-green-600"
                />
                <PrinterIcon
                  v-else-if="d.capabilities.print && !d.capabilities.scan"
                  class="w-5 h-5 text-blue-600"
                />
                <CopyIcon
                  v-else
                  class="w-5 h-5 text-purple-600"
                />
              </div>

              <!-- Info -->
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-gray-900 truncate">
                  {{ d.name }}
                </p>
                <p class="text-xs text-gray-400 mt-0.5">
                  {{ d.vidpid }} · Bus {{ d.bus }}
                </p>
              </div>

              <!-- Capability badges -->
              <div class="flex flex-wrap gap-1 justify-end items-center">
                <span
                  v-if="d.capabilities.print"
                  class="badge-blue"
                  :data-testid="`usb-cap-print-${d.vidpid.replace(':', '-')}`"
                >Print</span>
                <span
                  v-if="d.capabilities.scan"
                  class="badge-green"
                  :data-testid="`usb-cap-scan-${d.vidpid.replace(':', '-')}`"
                >Scan</span>
                <span
                  v-if="d.capabilities.escl"
                  class="badge-purple"
                  :data-testid="`usb-cap-escl-${d.vidpid.replace(':', '-')}`"
                >AirScan</span>
                <span
                  v-if="d.capabilities.fax"
                  class="badge-gray"
                  :data-testid="`usb-cap-fax-${d.vidpid.replace(':', '-')}`"
                >Fax</span>
                <Button
                  v-if="d.capabilities.print && !isInCups(d) && d.make"
                  variant="primary"
                  size="sm"
                  class="ml-2"
                  :loading="autoAdding === d.vidpid"
                  @click="onAutoAdd(d)"
                >
                  <PlusIcon class="w-3.5 h-3.5" />
                  Add to CUPS
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <!-- ── AirPrint & Network Discovery ──────────────────────────────── -->
      <Card>
        <h2 class="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <WifiIcon class="w-4 h-4 text-primary-600" />
          Network Discovery
        </h2>
        <div class="grid sm:grid-cols-2 gap-4">
          <div
            v-for="proto in protocols"
            :key="proto.label"
            class="flex gap-3 p-3 rounded-xl bg-gray-50"
          >
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="proto.bg"
            >
              <component
                :is="proto.icon"
                class="w-4 h-4"
                :class="proto.color"
              />
            </div>
            <div>
              <p class="text-xs font-semibold text-gray-800">
                {{ proto.label }}
              </p>
              <p class="text-xs text-gray-500 mt-0.5">
                {{ proto.desc }}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>

    <!-- ── Printer Settings Modal ─────────────────────────────────────── -->
    <Modal
      v-model="showPrinterSettings"
      :title="`Settings — ${settingsPrinterName}`"
    >
      <div class="space-y-4">
        <!-- Actions -->
        <div>
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Queue Actions
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              @click="onPrinterAction(settingsPrinterName, 'enable')"
            >
              Enable
            </Button>
            <Button
              size="sm"
              variant="secondary"
              @click="onPrinterAction(settingsPrinterName, 'disable')"
            >
              Pause
            </Button>
            <Button
              size="sm"
              variant="secondary"
              @click="onPrinterAction(settingsPrinterName, 'accept')"
            >
              Accept Jobs
            </Button>
            <Button
              size="sm"
              variant="secondary"
              @click="onPrinterAction(settingsPrinterName, 'reject')"
            >
              Reject Jobs
            </Button>
            <Button
              size="sm"
              variant="secondary"
              class="text-red-600"
              @click="onPrinterAction(settingsPrinterName, 'cancel-jobs')"
            >
              Cancel All Jobs
            </Button>
          </div>
        </div>

        <!-- Driver options -->
        <div>
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Driver Options
          </p>
          <div
            v-if="loadingAttributes"
            class="space-y-2"
          >
            <div
              v-for="i in 3"
              :key="i"
              class="h-12 bg-gray-100 rounded-xl animate-pulse"
            ></div>
          </div>
          <p
            v-else-if="printerOptions.length === 0"
            class="text-sm text-gray-400"
          >
            No configurable options reported by this driver.
          </p>
          <div
            v-else
            class="space-y-3"
          >
            <div
              v-for="opt in printerOptions"
              :key="opt.key"
            >
              <label
                :for="`opt-${opt.key}`"
                class="block text-xs font-medium text-gray-700 mb-1"
              >{{ opt.label }}</label>
              <select
                :id="`opt-${opt.key}`"
                class="w-full rounded-xl border-gray-200 text-sm"
                :value="opt.current ?? ''"
                @change="onOptionChange(opt.key, ($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="v in opt.values"
                  :key="v.value"
                  :value="v.value"
                >
                  {{ v.label }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <Button
          variant="ghost"
          @click="showPrinterSettings = false"
        >
          Close
        </Button>
      </template>
    </Modal>

    <!-- ── Add Printer Modal ───────────────────────────────────────────── -->
    <Modal
      v-model="showAddPrinter"
      title="Add Network Printer"
    >
      <div class="space-y-4">
        <div>
          <label
            for="printer-name"
            class="block text-xs font-medium text-gray-700 mb-1"
          >Printer Name</label>
          <input
            id="printer-name"
            v-model="newPrinterName"
            type="text"
            placeholder="e.g. HP-LaserJet"
            class="w-full rounded-xl border-gray-200 text-sm"
            autocomplete="off"
          />
          <p class="text-xs text-gray-400 mt-1">
            Letters, numbers, hyphens only
          </p>
        </div>
        <div>
          <label
            for="printer-uri"
            class="block text-xs font-medium text-gray-700 mb-1"
          >IPP Address</label>
          <input
            id="printer-uri"
            v-model="newPrinterUri"
            type="text"
            placeholder="ipp://192.168.1.100/ipp/print"
            class="w-full rounded-xl border-gray-200 text-sm font-mono"
            autocomplete="off"
          />
          <p class="text-xs text-gray-400 mt-1">
            IPP or IPPS URI of the printer
          </p>
        </div>
        <div class="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
          <p class="font-medium">
            Finding the IPP address
          </p>
          <p>
            Most modern printers broadcast their IPP address via mDNS. Run
            <code class="bg-blue-100 px-1 rounded">dns-sd -B _ipp._tcp</code>
            (macOS) or
            <code class="bg-blue-100 px-1 rounded">avahi-browse -r _ipp._tcp</code>
            (Linux) to discover nearby printers.
          </p>
        </div>
      </div>

      <template #footer>
        <Button
          variant="ghost"
          @click="showAddPrinter = false"
        >
          Cancel
        </Button>
        <Button
          :loading="addingPrinter"
          :disabled="!newPrinterName || !newPrinterUri"
          @click="onAddPrinter"
        >
          <PlusIcon class="w-4 h-4" />
          Add Printer
        </Button>
      </template>
    </Modal>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  PrinterIcon, ScanIcon, UsbIcon, RefreshCwIcon, PlusIcon,
  Trash2Icon, FileCheckIcon, WifiIcon, CopyIcon,
  SmartphoneIcon, MonitorIcon, AppleIcon, RotateCcwIcon,
  PlayIcon, PauseIcon, SettingsIcon,
} from 'lucide-vue-next'
import AppShell   from '@/components/layout/AppShell.vue'
import Card       from '@/components/ui/Card.vue'
import Button     from '@/components/ui/Button.vue'
import Modal      from '@/components/ui/Modal.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useDevicesStore, testPrintDevice, printerActionFn, fetchPrinterAttributesFn, setPrinterOptionFn } from '@/stores/devices'
import type { UsbDevice, CupsPrinter, PrinterOption } from '@/stores/devices'
import { useToastStore }  from '@/stores/toast'
import { RouterLink } from 'vue-router'

type SvcStatus = 'ok' | 'warning' | 'error' | 'pending' | 'offline' | 'unknown'

const devices = useDevicesStore()
const toast   = useToastStore()

const showAddPrinter  = ref(false)
const newPrinterName  = ref('')
const newPrinterUri   = ref('')
const addingPrinter   = ref(false)
const testingPrinter  = ref<string | null>(null)
const autoAdding      = ref<string | null>(null)
const resetting       = ref(false)
const actionLoading   = ref<string | null>(null)

// Printer settings modal
const showPrinterSettings  = ref(false)
const settingsPrinterName  = ref('')
const printerOptions       = ref<PrinterOption[]>([])
const loadingAttributes    = ref(false)

async function openPrinterSettings(name: string) {
  settingsPrinterName.value = name
  printerOptions.value      = []
  showPrinterSettings.value = true
  loadingAttributes.value   = true
  try {
    printerOptions.value = await fetchPrinterAttributesFn(name)
  } catch {
    // Options not available for this driver — show empty state
  } finally {
    loadingAttributes.value = false
  }
}

async function onOptionChange(key: string, value: string) {
  try {
    await setPrinterOptionFn(settingsPrinterName.value, key, value)
    toast.success('Option saved')
  } catch (err) {
    toast.error('Could not set option', err instanceof Error ? err.message : String(err))
  }
}

onMounted(() => devices.fetchDevices())

function isInCups(d: UsbDevice): boolean {
  return devices.printers.some(p => p.uri.includes(`/${d.make}/`) ||
    (d.model && p.uri.includes(encodeURIComponent(d.model))))
}

async function onAutoAdd(d: UsbDevice) {
  autoAdding.value = d.vidpid
  try {
    const result = await devices.autoAddPrinter(d.vidpid)
    toast.success('Printer added', `${result.name} is now available.`)
  } catch (err) {
    toast.error('Auto-add failed', err instanceof Error ? err.message : String(err))
  } finally {
    autoAdding.value = null
  }
}

async function onReset() {
  if (!globalThis.confirm(
    'Reset detection?\n\n' +
    'This will remove ALL configured CUPS printers and clear the setup ' +
    'wizard, so you can re-run discovery from scratch.\n\n' +
    'USB devices and scanned files are NOT deleted.'
  )) return
  resetting.value = true
  try {
    const r = await devices.resetAll()
    if (r.removed.length > 0) {
      toast.success('Detection reset', `Removed ${r.removed.length} printer(s): ${r.removed.join(', ')}`)
    } else {
      toast.success('Detection reset', 'No printers were configured.')
    }
    if (r.errors.length > 0) {
      toast.error('Some items could not be reset', r.errors.join('; '))
    }
  } catch (err) {
    toast.error('Reset failed', err instanceof Error ? err.message : String(err))
  } finally {
    resetting.value = false
  }
}

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

async function onPrinterAction(name: string, action: string) {
  const key = `${name}:${action}`
  actionLoading.value = key
  try {
    await printerActionFn(name, action as import('@/stores/devices').PrinterAction)
    toast.success('Done', `${action} applied to ${name}`)
    await devices.fetchDevices()
  } catch (err) {
    toast.error('Action failed', err instanceof Error ? err.message : String(err))
  } finally {
    if (actionLoading.value === key) actionLoading.value = null
  }
}

async function onAddPrinter() {
  addingPrinter.value = true
  try {
    await devices.addPrinter(newPrinterName.value.trim(), newPrinterUri.value.trim())
    toast.success('Printer added', `${newPrinterName.value} is now available.`)
    showAddPrinter.value = false
    newPrinterName.value = ''
    newPrinterUri.value  = ''
  } catch (err) {
    toast.error('Could not add printer', err instanceof Error ? err.message : String(err))
  } finally {
    addingPrinter.value = false
  }
}

async function onRemovePrinter(name: string) {
  if (!globalThis.confirm(`Remove printer "${name}"?`)) return
  try {
    await devices.removePrinter(name)
    toast.success('Printer removed')
  } catch (err) {
    toast.error('Remove failed', err instanceof Error ? err.message : String(err))
  }
}

async function onTestPrint(name: string) {
  testingPrinter.value = name
  try {
    const msg = await testPrintDevice(name)
    toast.success('Test page sent', msg)
  } catch (err) {
    toast.error('Test print failed', err instanceof Error ? err.message : String(err))
  } finally {
    testingPrinter.value = null
  }
}

const protocols = [
  {
    label: 'AirPrint',
    desc:  'iOS & macOS discover this printer automatically — no driver needed.',
    icon:  AppleIcon,
    bg:    'bg-gray-800',
    color: 'text-white',
  },
  {
    label: 'Mopria / IPP Everywhere',
    desc:  'Android 9+ and Windows 11 find the printer via Mopria auto-discovery.',
    icon:  SmartphoneIcon,
    bg:    'bg-green-100',
    color: 'text-green-700',
  },
  {
    label: 'Windows IPP',
    desc:  'Settings → Printers & scanners → Add device discovers it automatically.',
    icon:  MonitorIcon,
    bg:    'bg-blue-100',
    color: 'text-blue-700',
  },
  {
    label: 'Linux CUPS',
    desc:  'Add via CUPS web UI at :631 or run lpadmin -p Name -m everywhere -v <IPP URI>.',
    icon:  WifiIcon,
    bg:    'bg-orange-100',
    color: 'text-orange-700',
  },
]
</script>

<style scoped>
.badge-blue   { @apply text-xs bg-blue-50 text-blue-600 rounded px-1.5 py-0.5 font-medium; }
.badge-green  { @apply text-xs bg-green-50 text-green-600 rounded px-1.5 py-0.5 font-medium; }
.badge-purple { @apply text-xs bg-purple-50 text-purple-600 rounded px-1.5 py-0.5 font-medium; }
.badge-gray   { @apply text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 font-medium; }
</style>
