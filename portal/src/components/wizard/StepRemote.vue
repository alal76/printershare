<!-- Beta test version v1.2.0 -->
<template>
  <div class="space-y-4">
    <h3 class="font-semibold text-gray-900">
      Remote Access (Optional)
    </h3>
    <p class="text-sm text-gray-500">
      Access your printer from outside your home network.
    </p>

    <div class="space-y-3">
      <div class="flex items-center gap-3">
        <input
          id="ts-enable"
          v-model="tailscale"
          type="checkbox"
          class="rounded border-gray-300 text-primary-600"
          @change="update"
        />
        <label
          for="ts-enable"
          class="text-sm text-gray-700"
        >Enable Tailscale VPN</label>
      </div>
      <div v-if="tailscale">
        <label
          for="ts-key"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Tailscale Auth Key</label>
        <input
          id="ts-key"
          v-model="tsKey"
          type="password"
          autocomplete="off"
          placeholder="tskey-auth-..."
          class="w-full rounded-xl border-gray-200 text-sm"
          @input="update"
        />
        <p class="text-xs text-gray-400 mt-1">
          Generate at <a
            href="https://login.tailscale.com/admin/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary-600 hover:underline"
          >tailscale.com/admin</a>
        </p>
      </div>

      <div class="flex items-center gap-3">
        <input
          id="cf-enable"
          v-model="cloudflared"
          type="checkbox"
          class="rounded border-gray-300 text-primary-600"
          @change="update"
        />
        <label
          for="cf-enable"
          class="text-sm text-gray-700"
        >Enable Cloudflare Tunnel</label>
      </div>
      <div v-if="cloudflared">
        <label
          for="cf-token"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Cloudflare Tunnel Token</label>
        <input
          id="cf-token"
          v-model="cfToken"
          type="password"
          autocomplete="off"
          placeholder="eyJhIjo..."
          class="w-full rounded-xl border-gray-200 text-sm"
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

const tailscale   = ref(Boolean(props.config.TAILSCALE_AUTH_KEY))
const tsKey       = ref(props.config.TAILSCALE_AUTH_KEY      || '')
const cloudflared = ref(Boolean(props.config.CLOUDFLARE_TUNNEL_TOKEN))
const cfToken     = ref(props.config.CLOUDFLARE_TUNNEL_TOKEN  || '')

function update() {
  const profiles: string[] = []
  if (tailscale.value || cloudflared.value) profiles.push('remote')
  emit('update:config', {
    ...props.config,
    TAILSCALE_AUTH_KEY:      tsKey.value,
    CLOUDFLARE_TUNNEL_TOKEN: cfToken.value,
    COMPOSE_PROFILES:        profiles.join(','),
  })
  emit('valid', true)
}
onMounted(update)
</script>
