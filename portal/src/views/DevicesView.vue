<template>
  <AppShell title="Devices">
    <div class="max-w-3xl space-y-6">
      <!-- Refresh button -->
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">
          Manage connected printers and scanners. USB devices are detected
          automatically; network printers can be added via IPP.
        </p>
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
            <div class="flex items-center gap-4 p-4">
              <!-- Status icon -->
              <div
                class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                :class="printerIconBg(p.state)"
              >
                <PrinterIcon
                  class="w-5 h-5"
                  :class="printerIconColor(p.state)"
                />
              </div>

              <!-- Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-gray-900 truncate">{{ p.name }}</span>
                  <StatusBadge
                    :status="printerStatus(p.state)"
                    :label="p.state"
                  />
                </div>
                <p class="text-xs text-gray-400 truncate mt-0.5">
                  {{ p.uri || 'No URI' }}
                </p>
              </div>

              <!-- Actions -->
              <div class="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  :loading="testingPrinter === p.name"
                  @click="onTestPrint(p.name)"
                >
                  <FileCheckIcon class="w-3.5 h-3.5" />
                  Test
                </Button>
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
              <div class="flex flex-wrap gap-1 justify-end">
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
  SmartphoneIcon, MonitorIcon, AppleIcon,
} from 'lucide-vue-next'
import AppShell   from '@/components/layout/AppShell.vue'
import Card       from '@/components/ui/Card.vue'
import Button     from '@/components/ui/Button.vue'
import Modal      from '@/components/ui/Modal.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useDevicesStore, testPrintDevice } from '@/stores/devices'
import { useToastStore }  from '@/stores/toast'

type SvcStatus = 'ok' | 'warning' | 'error' | 'pending' | 'offline' | 'unknown'

const devices = useDevicesStore()
const toast   = useToastStore()

const showAddPrinter  = ref(false)
const newPrinterName  = ref('')
const newPrinterUri   = ref('')
const addingPrinter   = ref(false)
const testingPrinter  = ref<string | null>(null)

onMounted(() => devices.fetchDevices())

function printerStatus(state: string): SvcStatus {
  if (state === 'idle')     return 'ok'
  if (state === 'busy')     return 'pending'
  if (state === 'disabled') return 'offline'
  return 'unknown'
}
function printerIconBg(state: string) {
  if (state === 'idle')     return 'bg-green-50'
  if (state === 'busy')     return 'bg-blue-50'
  if (state === 'disabled') return 'bg-gray-100'
  return 'bg-gray-100'
}
function printerIconColor(state: string) {
  if (state === 'idle')     return 'text-green-600'
  if (state === 'busy')     return 'text-blue-600'
  if (state === 'disabled') return 'text-gray-400'
  return 'text-gray-400'
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
