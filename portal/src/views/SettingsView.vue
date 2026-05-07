<template>
  <AppShell title="Settings">
    <div class="max-w-2xl space-y-6">
      <!-- ── Network ─────────────────────────────────────────────────────── -->
      <SettingsSection
        title="Network"
        description="Ports and hostnames for this device."
        icon="network"
        :fields="networkFields"
        :patch="patch"
        :loading="loading"
        :saving="savingGroup === 'network'"
        @save="saveGroup('network', networkFields)"
        @update:patch="patch = $event"
      />

      <!-- ── Sharing ─────────────────────────────────────────────────────── -->
      <SettingsSection
        title="File Sharing"
        description="Samba share and NFS export configuration."
        icon="share"
        :fields="sharingFields"
        :patch="patch"
        :loading="loading"
        :saving="savingGroup === 'sharing'"
        @save="saveGroup('sharing', sharingFields)"
        @update:patch="patch = $event"
      />

      <!-- ── Security ────────────────────────────────────────────────────── -->
      <SettingsSection
        title="Security & Passwords"
        description="Credentials used by this service. Values are stored in the .env file."
        icon="shield"
        :fields="securityFields"
        :patch="patch"
        :loading="loading"
        :saving="savingGroup === 'security'"
        @save="saveGroup('security', securityFields)"
        @update:patch="patch = $event"
      />

      <!-- ── Cloud Backup ────────────────────────────────────────────────── -->
      <SettingsSection
        title="Cloud Backup"
        description="Rclone remote for automatic scan file backups."
        icon="cloud"
        :fields="cloudFields"
        :patch="patch"
        :loading="loading"
        :saving="savingGroup === 'cloud'"
        @save="saveGroup('cloud', cloudFields)"
        @update:patch="patch = $event"
      />

      <!-- ── Remote Access ───────────────────────────────────────────────── -->
      <SettingsSection
        title="Remote Access"
        description="Tailscale VPN and Cloudflare Tunnel for access outside your LAN."
        icon="globe"
        :fields="remoteFields"
        :patch="patch"
        :loading="loading"
        :saving="savingGroup === 'remote'"
        @save="saveGroup('remote', remoteFields)"
        @update:patch="patch = $event"
      />

      <!-- ── Service Controls ────────────────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center">
            <RefreshCwIcon class="w-4 h-4 text-gray-600" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-gray-900">
              Service Controls
            </h2>
            <p class="text-xs text-gray-500">
              Restart individual services without rebuilding.
            </p>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <button
            v-for="svc in services"
            :key="svc"
            type="button"
            class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            :disabled="restarting === svc"
            @click="restart(svc)"
          >
            <Loader2Icon
              v-if="restarting === svc"
              class="w-3 h-3 animate-spin"
            />
            <RefreshCwIcon
              v-else
              class="w-3 h-3 text-gray-400"
            />
            {{ svc }}
          </button>
        </div>
      </Card>

      <!-- ── Setup Wizard ────────────────────────────────────────────────── -->
      <Card>
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-gray-900">
              Setup Wizard
            </h2>
            <p class="text-xs text-gray-500 mt-0.5">
              Re-run the wizard to change your initial configuration.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            @click="resetWizard"
          >
            <WandIcon class="w-3.5 h-3.5" />
            Re-run Wizard
          </Button>
        </div>
      </Card>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter }      from 'vue-router'
import { RefreshCwIcon, Loader2Icon, WandIcon } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import Card     from '@/components/ui/Card.vue'
import Button   from '@/components/ui/Button.vue'
import SettingsSection from '@/components/settings/SettingsSection.vue'
import { useToastStore }  from '@/stores/toast'
import { useSystemStore } from '@/stores/system'

const toast   = useToastStore()
const system  = useSystemStore()
const router  = useRouter()

const loading    = ref(false)
const savingGroup = ref<string | null>(null)
const patch      = ref<Record<string, string>>({})
const restarting = ref<string | null>(null)

// ── Field group definitions ────────────────────────────────────────────────
interface Field { key: string; label: string; placeholder?: string; secret?: boolean; hint?: string }

const networkFields: Field[] = [
  { key: 'NGINX_HTTP_PORT',  label: 'HTTP Port',    placeholder: '80' },
  { key: 'NGINX_HTTPS_PORT', label: 'HTTPS Port',   placeholder: '443' },
  { key: 'CUPS_HOST',   label: 'CUPS Host',    placeholder: 'cups' },
  { key: 'CUPS_PORT',   label: 'CUPS Port',    placeholder: '631' },
]

const sharingFields: Field[] = [
  { key: 'SAMBA_WORKGROUP', label: 'Samba Workgroup',  placeholder: 'WORKGROUP' },
  { key: 'SAMBA_SHARE',     label: 'Share Name',       placeholder: 'scans' },
  { key: 'NFS_ALLOWED_SUBNET', label: 'NFS Allowed Network', placeholder: '192.168.1.0/24', hint: 'CIDR of hosts allowed to mount via NFS' },
]

const securityFields: Field[] = [
  { key: 'SAMBA_PASS',    label: 'Samba Password', secret: true },
  { key: 'PORTAL_SECRET', label: 'Portal JWT Secret', secret: true },
]

const cloudFields: Field[] = [
  { key: 'RCLONE_REMOTE', label: 'Rclone Remote Name', placeholder: 'gdrive', hint: 'Name of the rclone remote (leave blank to disable)' },
  { key: 'RCLONE_BUCKET', label: 'Bucket / Path',      placeholder: 'my-bucket/scans' },
]

const remoteFields: Field[] = [
  { key: 'TAILSCALE_AUTH_KEY',      label: 'Tailscale Auth Key',      secret: true },
  { key: 'CLOUDFLARE_TUNNEL_TOKEN', label: 'Cloudflare Tunnel Token', secret: true },
]

const services = ['cups', 'ipp-usb', 'scanservjs', 'samba', 'nginx']

// ── Load settings ─────────────────────────────────────────────────────────
onMounted(async () => {
  loading.value = true
  try {
    const r = await fetch('/api/v1/settings')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    patch.value = await r.json() as Record<string, string>
  } catch {
    toast.error('Could not load settings')
  } finally {
    loading.value = false
  }
})

// ── Save a group of fields ─────────────────────────────────────────────────
async function saveGroup(groupName: string, fields: Field[]) {
  savingGroup.value = groupName
  const groupPatch: Record<string, string> = {}
  for (const f of fields) {
    if (patch.value[f.key] !== undefined) {
      groupPatch[f.key] = patch.value[f.key]
    }
  }
  try {
    const r = await fetch('/api/v1/settings', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(groupPatch),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    toast.success('Settings saved')
  } catch (err) {
    toast.error('Save failed', err instanceof Error ? err.message : String(err))
  } finally {
    savingGroup.value = null
  }
}

// ── Service restart ────────────────────────────────────────────────────────
async function restart(svc: string) {
  restarting.value = svc
  try {
    const r = await fetch(`/api/v1/services/${svc}/restart`, { method: 'POST' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    toast.success(`Restarted ${svc}`)
  } catch (err) {
    toast.error('Restart failed', err instanceof Error ? err.message : String(err))
  } finally {
    restarting.value = null
  }
}

// ── Wizard reset ───────────────────────────────────────────────────────────
async function resetWizard() {
  await fetch('/api/v1/wizard/reset', { method: 'POST' })
  system.wizardCompleted = false
  await router.push('/wizard')
}
</script>
