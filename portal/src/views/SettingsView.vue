<template>
  <AppShell title="Settings">
    <div class="max-w-2xl space-y-6">
      <!-- Environment variables -->
      <Card>
        <h2 class="text-sm font-semibold text-gray-900 mb-4">Environment Configuration</h2>
        <div v-if="loading" class="space-y-2">
          <div v-for="i in 6" :key="i" class="h-8 bg-gray-100 rounded-lg animate-pulse" />
        </div>
        <form v-else class="space-y-3" @submit.prevent="save">
          <div v-for="(val, key) in settings" :key="key">
            <label :for="`env-${key}`" class="block text-xs font-medium text-gray-700 mb-1 font-mono">{{ key }}</label>
            <input
              :id="`env-${key}`"
              v-model="patch[key]"
              :type="isSecret(String(key)) ? 'password' : 'text'"
              autocomplete="off"
              :placeholder="String(val)"
              class="w-full rounded-xl border-gray-200 text-sm font-mono"
            />
          </div>
          <Button type="submit" :loading="saving">Save Changes</Button>
        </form>
      </Card>

      <!-- Service controls -->
      <Card>
        <h2 class="text-sm font-semibold text-gray-900 mb-4">Service Controls</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <button
            v-for="svc in services"
            :key="svc"
            class="btn-secondary text-xs py-2"
            :disabled="restarting === svc"
            @click="restart(svc)"
          >
            <Loader2Icon v-if="restarting === svc" class="w-3 h-3 animate-spin" />
            <RefreshCwIcon v-else class="w-3 h-3" />
            Restart {{ svc }}
          </button>
        </div>
      </Card>

      <!-- Wizard reset -->
      <Card>
        <h2 class="text-sm font-semibold text-gray-900 mb-2">Setup Wizard</h2>
        <p class="text-xs text-gray-500 mb-3">Re-run the setup wizard to change your configuration.</p>
        <Button variant="secondary" @click="resetWizard">Re-run Setup Wizard</Button>
      </Card>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter }      from 'vue-router'
import { RefreshCwIcon, Loader2Icon } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import Card     from '@/components/ui/Card.vue'
import Button   from '@/components/ui/Button.vue'
import { useToastStore }  from '@/stores/toast'
import { useSystemStore } from '@/stores/system'

const toast   = useToastStore()
const system  = useSystemStore()
const router  = useRouter()
const loading = ref(false)
const saving  = ref(false)
const settings = ref<Record<string, string>>({})
const patch    = ref<Record<string, string>>({})
const restarting = ref<string | null>(null)

const services = ['cups', 'ipp-usb', 'scanservjs', 'samba', 'nginx']
const SECRET_KEYS = new Set(['SAMBA_PASS', 'PORTAL_SECRET', 'TAILSCALE_AUTH_KEY', 'CLOUDFLARE_TUNNEL_TOKEN'])

function isSecret(key: string) { return SECRET_KEYS.has(key) }

onMounted(async () => {
  loading.value = true
  try {
    const r = await fetch('/api/v1/settings')
    settings.value = await r.json()
    patch.value    = { ...settings.value }
  } finally {
    loading.value = false
  }
})

async function save() {
  saving.value = true
  try {
    const r = await fetch('/api/v1/settings', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch.value),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    toast.success('Settings saved')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    toast.error('Save failed', msg)
  } finally {
    saving.value = false
  }
}

async function restart(svc: string) {
  restarting.value = svc
  try {
    const r = await fetch(`/api/v1/services/${svc}/restart`, { method: 'POST' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    toast.success(`Restarted ${svc}`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    toast.error(`Restart failed`, msg)
  } finally {
    restarting.value = null
  }
}

async function resetWizard() {
  await fetch('/api/v1/wizard/reset', { method: 'POST' })
  system.wizardCompleted = false
  await router.push('/wizard')
}
</script>
