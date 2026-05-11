<!-- Beta test version v1.2.0 -->
<template>
  <div class="space-y-4">
    <h3 class="font-semibold text-gray-900">
      Set Passwords
    </h3>
    <p class="text-sm text-gray-500">
      These are used for Samba file sharing and the portal admin.
    </p>

    <div class="space-y-3">
      <div>
        <label
          for="samba-pass"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Samba Password</label>
        <input
          id="samba-pass"
          v-model="sambaPass"
          type="password"
          autocomplete="new-password"
          class="w-full rounded-xl border-gray-200 text-sm focus:ring-primary-500 focus:border-primary-500"
          @input="update"
        />
      </div>
      <div>
        <label
          for="portal-secret"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Portal Secret (JWT signing key)</label>
        <div class="flex gap-2">
          <input
            id="portal-secret"
            v-model="portalSecret"
            type="text"
            autocomplete="off"
            class="flex-1 rounded-xl border-gray-200 text-sm font-mono focus:ring-primary-500 focus:border-primary-500"
            @input="update"
          />
          <button
            class="btn-secondary text-xs py-2"
            type="button"
            @click="generateSecret"
          >
            Generate
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="sambaPass"
      class="flex items-center gap-2"
    >
      <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-300"
          :class="strengthBar"
          :style="{ width: `${strength * 25}%` }"
        ></div>
      </div>
      <span class="text-xs text-gray-500">{{ strengthLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const props = defineProps<{ config: Record<string, string> }>()
const emit  = defineEmits<{
  (e: 'update:config', v: Record<string, string>): void
  (e: 'valid', v: boolean): void
}>()

const sambaPass    = ref(props.config.SAMBA_PASS    || '')
const portalSecret = ref(props.config.PORTAL_SECRET || '')

const strength = computed(() => {
  const p = sambaPass.value
  if (!p) return 0
  let s = 0
  if (p.length >= 8)          s++
  if (p.length >= 12)         s++
  if (/[A-Z]/.test(p))        s++
  if (/[0-9!@#$%^&*]/.test(p)) s++
  return s
})
const strengthLabel = computed(() => ['', 'Weak', 'Fair', 'Good', 'Strong'][strength.value])
const strengthBar   = computed(() => ['', 'bg-red-400', 'bg-yellow-400', 'bg-blue-400', 'bg-green-500'][strength.value])

function generateSecret() {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  portalSecret.value = [...arr].map(b => b.toString(16).padStart(2, '0')).join('')
  update()
}

function update() {
  emit('update:config', { ...props.config, SAMBA_PASS: sambaPass.value, PORTAL_SECRET: portalSecret.value })
  emit('valid', sambaPass.value.length >= 4 && portalSecret.value.length >= 8)
}

onMounted(() => {
  if (!portalSecret.value) generateSecret()
  update()
})
</script>
