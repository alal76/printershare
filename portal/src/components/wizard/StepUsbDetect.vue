<template>
  <div class="space-y-4">
    <h3 class="font-semibold text-gray-900">
      Detect USB Device
    </h3>
    <p class="text-sm text-gray-500">
      Connect your USB printer or scanner then click Scan.
    </p>

    <button
      type="button"
      class="btn-secondary text-sm"
      :disabled="scanning"
      @click="scan"
    >
      <Loader2Icon
        v-if="scanning"
        class="w-4 h-4 animate-spin"
      />
      <UsbIcon
        v-else
        class="w-4 h-4"
      />
      {{ scanning ? 'Scanning…' : 'Scan USB Devices' }}
    </button>

    <div
      v-if="devices.length === 0 && !scanning"
      class="text-sm text-gray-400 text-center py-6 border border-dashed rounded-xl"
    >
      No USB devices detected yet
    </div>

    <div
      v-if="devices.length > 0"
      class="grid gap-2"
    >
      <button
        v-for="d in devices"
        :key="d.vidpid"
        type="button"
        class="flex items-center gap-3 p-3 rounded-xl border text-left transition-colors"
        :class="selected?.vidpid === d.vidpid ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-primary-200'"
        @click="select(d)"
      >
        <UsbIcon class="w-5 h-5 text-gray-400 flex-shrink-0" />
        <div class="flex-1">
          <p class="text-sm font-medium text-gray-900">
            {{ d.name }}
          </p>
          <p class="text-xs text-gray-500">
            {{ d.vidpid }}
          </p>
        </div>
        <div class="flex gap-1">
          <span
            v-if="d.capabilities.print"
            class="text-xs bg-blue-50 text-blue-600 rounded px-1.5 py-0.5"
          >Print</span>
          <span
            v-if="d.capabilities.scan"
            class="text-xs bg-green-50 text-green-600 rounded px-1.5 py-0.5"
          >Scan</span>
          <span
            v-if="d.capabilities.escl"
            class="text-xs bg-purple-50 text-purple-600 rounded px-1.5 py-0.5"
          >AirScan</span>
        </div>
      </button>
    </div>

    <p
      v-if="!selected && !scanning"
      class="text-xs text-amber-600"
    >
      Select a device to continue (or skip if not connected).
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref }          from 'vue'
import { UsbIcon, Loader2Icon } from 'lucide-vue-next'

interface UsbDevice {
  vidpid: string
  name:   string
  capabilities: { print: boolean; scan: boolean; fax: boolean; escl: boolean }
}

const props = defineProps<{ config: Record<string, string> }>()
const emit  = defineEmits<{
  (e: 'update:config', v: Record<string, string>): void
  (e: 'valid', v: boolean): void
}>()

const scanning = ref(false)
const devices  = ref<UsbDevice[]>([])
const selected = ref<UsbDevice | null>(null)

async function scan() {
  scanning.value = true
  try {
    const r = await fetch('/api/v1/system/usb')
    const d = await r.json()
    devices.value = d.devices ?? []
  } finally {
    scanning.value = false
  }
}

function select(d: UsbDevice) {
  selected.value = d
  emit('update:config', { ...props.config, USB_VID: d.vidpid.split(':')[0], USB_PID: d.vidpid.split(':')[1] })
  emit('valid', true)
}
</script>
