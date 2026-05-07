<template>
  <div class="space-y-4">
    <h3 class="font-semibold text-gray-900">
      Network Options
    </h3>
    <p class="text-sm text-gray-500">
      Configure HTTPS port and NFS subnet (optional).
    </p>
    <div class="space-y-3">
      <div>
        <label
          for="https-port"
          class="block text-xs font-medium text-gray-700 mb-1"
        >HTTPS Port</label>
        <input
          id="https-port"
          v-model="httpsPort"
          type="number"
          min="1024"
          max="65535"
          class="w-full rounded-xl border-gray-200 text-sm focus:ring-primary-500 focus:border-primary-500"
          @input="update"
        />
      </div>
      <div>
        <label
          for="samba-subnet"
          class="block text-xs font-medium text-gray-700 mb-1"
        >NFS Allowed Subnet (CIDR)</label>
        <input
          id="samba-subnet"
          v-model="sambaSubnet"
          type="text"
          placeholder="192.168.1.0/24"
          class="w-full rounded-xl border-gray-200 text-sm focus:ring-primary-500 focus:border-primary-500"
          @input="update"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{ config: Record<string, string> }>()
const emit  = defineEmits<{
  (e: 'update:config', v: Record<string, string>): void
  (e: 'valid', v: boolean): void
}>()

const httpsPort   = ref(props.config.NGINX_HTTPS_PORT  || '443')
const sambaSubnet = ref(props.config.NFS_ALLOWED_SUBNET || '192.168.1.0/24')

function update() {
  emit('update:config', { ...props.config, NGINX_HTTPS_PORT: httpsPort.value, NFS_ALLOWED_SUBNET: sambaSubnet.value })
  emit('valid', true)
}
onMounted(update)
</script>
