<!-- Beta test version v1.2.0 -->
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

      <!-- ── Admin Access ────────────────────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 mb-5">
          <div class="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
            <LockIcon class="w-4 h-4 text-orange-600" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-gray-900">
              Admin Access
            </h2>
            <p class="text-xs text-gray-500">
              Require a login to access this portal.
            </p>
          </div>
        </div>

        <!-- Auth toggle -->
        <div class="flex items-center justify-between mb-4">
          <div>
            <p class="text-sm font-medium text-gray-800">
              Require login
            </p>
            <p class="text-xs text-gray-500 mt-0.5">
              When enabled, visitors must log in with username &amp; password.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="authEnabled"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
            :class="authEnabled ? 'bg-primary-600' : 'bg-gray-200'"
            :disabled="savingAuth"
            @click="toggleAuth"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
              :class="authEnabled ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>

        <!-- Change password (only when auth enabled) -->
        <template v-if="authEnabled">
          <div class="border-t border-gray-100 pt-4 space-y-3">
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Change Admin Password
            </p>
            <div>
              <label
                for="admin-user"
                class="block text-xs font-medium text-gray-700 mb-1"
              >Username</label>
              <input
                id="admin-user"
                v-model="adminUser"
                type="text"
                autocomplete="username"
                placeholder="admin"
                class="w-full rounded-xl border-gray-200 text-sm"
              />
            </div>
            <div>
              <label
                for="admin-pass"
                class="block text-xs font-medium text-gray-700 mb-1"
              >New Password</label>
              <input
                id="admin-pass"
                v-model="adminPass"
                type="password"
                autocomplete="new-password"
                placeholder="Min 8 characters"
                class="w-full rounded-xl border-gray-200 text-sm"
              />
            </div>
            <Button
              size="sm"
              :loading="savingAdmin"
              :disabled="!adminPass || adminPass.length < 8"
              @click="saveAdmin"
            >
              Save Credentials
            </Button>
          </div>
        </template>
      </Card>

      <!-- ── Security & Passwords ────────────────────────────────────────── -->
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
        description="Rclone remotes for automatic scan file backups to Google Drive or OneDrive."
        icon="cloud"
        :fields="cloudFields"
        :patch="patch"
        :loading="loading"
        :saving="savingGroup === 'cloud'"
        @save="saveGroup('cloud', cloudFields)"
        @update:patch="patch = $event"
      />

      <!-- ── Tailscale ───────────────────────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <ShieldIcon class="w-4 h-4 text-indigo-600" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-semibold text-gray-900">
                Tailscale
              </h2>
              <StatusBadge
                v-if="tailscaleConnected"
                status="ok"
                label="Connected"
              />
            </div>
            <p class="text-xs text-gray-500 mt-0.5">
              Access this portal securely from anywhere, without port-forwarding.
            </p>
          </div>
        </div>

        <div
          v-if="tailscaleConnected"
          class="space-y-3"
        >
          <p
            v-if="tailscaleIp"
            class="font-mono text-xs text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2 inline-block"
          >
            {{ tailscaleIp }}
          </p>
          <div>
            <Button
              size="sm"
              variant="secondary"
              :loading="tailscaleLoggingOut"
              @click="onTailscaleLogout"
            >
              Disconnect
            </Button>
          </div>
        </div>

        <div
          v-else
          class="space-y-3"
        >
          <p class="text-xs text-gray-500">
            Log in with your Tailscale account in a browser — no auth key to generate or paste.
          </p>
          <div
            v-if="tailscaleLoginUrl"
            class="p-3 rounded-xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-800 space-y-2"
          >
            <p>Open this link to finish signing in (works from any device):</p>
            <a
              :href="tailscaleLoginUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="block truncate font-mono text-indigo-700 hover:underline"
            >{{ tailscaleLoginUrl }}</a>
            <p class="text-indigo-500">
              Waiting for you to finish in the browser — this updates automatically.
            </p>
          </div>
          <Button
            v-else
            size="sm"
            :loading="tailscaleLoggingIn"
            @click="onTailscaleLogin"
          >
            <ShieldIcon class="w-3.5 h-3.5" />
            Connect via Browser
          </Button>
        </div>
      </Card>

      <!-- ── Remote Access (advanced) ───────────────────────────────────── -->
      <SettingsSection
        title="Remote Access (Advanced)"
        description="Reusable Tailscale auth key (for unattended/scripted setup) and Cloudflare Tunnel."
        icon="globe"
        :fields="remoteFields"
        :patch="patch"
        :loading="loading"
        :saving="savingGroup === 'remote'"
        @save="saveGroup('remote', remoteFields)"
        @update:patch="patch = $event"
      />

      <!-- ── Optional Components ────────────────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center">
            <PackageIcon class="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-gray-900">
              Optional Components
            </h2>
            <p class="text-xs text-gray-500">
              Install missing system components with one click.
            </p>
          </div>
        </div>
        <div
          v-if="loadingComponents"
          class="space-y-2"
        >
          <div
            v-for="i in 3"
            :key="i"
            class="h-12 bg-gray-100 rounded-xl animate-pulse"
          ></div>
        </div>
        <p
          v-else-if="!nativeMode"
          class="text-sm text-gray-400"
        >
          Component install is only available in native deployment mode.
        </p>
        <div
          v-else
          class="space-y-2"
        >
          <div
            v-for="comp in components"
            :key="comp.name"
            class="flex items-center justify-between p-3 rounded-xl border border-gray-100"
          >
            <div class="flex-1 min-w-0 mr-4">
              <p class="text-sm font-medium text-gray-800">
                {{ comp.label }}
              </p>
              <p class="text-xs text-gray-400 truncate">
                {{ comp.description }}
              </p>
            </div>
            <div
              v-if="comp.installed"
              class="flex items-center gap-1.5 text-green-600 text-xs font-medium shrink-0"
            >
              <CheckCircle2Icon class="w-4 h-4" />
              Installed
            </div>
            <Button
              v-else
              size="sm"
              variant="secondary"
              :loading="installing === comp.name"
              :disabled="!!installing"
              @click="installComponent(comp.name)"
            >
              <DownloadIcon class="w-3.5 h-3.5" />
              Install
            </Button>
          </div>
        </div>
      </Card>

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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter }      from 'vue-router'
import { RefreshCwIcon, Loader2Icon, WandIcon, LockIcon, PackageIcon, CheckCircle2Icon, DownloadIcon, ShieldIcon } from 'lucide-vue-next'
import AppShell    from '@/components/layout/AppShell.vue'
import Card        from '@/components/ui/Card.vue'
import Button      from '@/components/ui/Button.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
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

// ── Tailscale ────────────────────────────────────────────────────────────
const tailscaleConnected = computed(() => system.health?.services?.tailscale?.status === 'ok')
const tailscaleIp        = computed(() => system.health?.services?.tailscale?.ip ?? null)
const tailscaleLoggingIn  = ref(false)
const tailscaleLoggingOut = ref(false)
const tailscaleLoginUrl   = ref<string | null>(null)
let tailscalePollTimer: ReturnType<typeof setInterval> | undefined

function stopTailscalePoll() {
  if (tailscalePollTimer) clearInterval(tailscalePollTimer)
  tailscalePollTimer = undefined
}

async function onTailscaleLogin() {
  tailscaleLoggingIn.value = true
  tailscaleLoginUrl.value  = null
  try {
    const r = await fetch('/api/v1/settings/tailscale/login', { method: 'POST' })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
    if (data.alreadyConnected) {
      toast.success('Tailscale connected')
      await system.fetchHealth()
    } else if (data.url) {
      tailscaleLoginUrl.value = data.url
      // Poll health every few seconds while waiting for the user to finish
      // the login in their browser; stop as soon as it reports connected.
      stopTailscalePoll()
      tailscalePollTimer = setInterval(async () => {
        await system.fetchHealth()
        if (tailscaleConnected.value) {
          stopTailscalePoll()
          tailscaleLoginUrl.value = null
          toast.success('Tailscale connected')
        }
      }, 4000)
    } else {
      toast.error('Tailscale login', 'Still starting — check back in a moment.')
    }
  } catch (err) {
    toast.error('Could not start Tailscale login', err instanceof Error ? err.message : String(err))
  } finally {
    tailscaleLoggingIn.value = false
  }
}

async function onTailscaleLogout() {
  tailscaleLoggingOut.value = true
  try {
    const r = await fetch('/api/v1/settings/tailscale/logout', { method: 'POST' })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
    toast.success('Tailscale disconnected')
    await system.fetchHealth()
  } catch (err) {
    toast.error('Could not disconnect', err instanceof Error ? err.message : String(err))
  } finally {
    tailscaleLoggingOut.value = false
  }
}

onUnmounted(stopTailscalePoll)

// ── Admin access ───────────────────────────────────────────────────────────
const authEnabled  = ref(false)
const savingAuth   = ref(false)
const adminUser    = ref('')
const adminPass    = ref('')
const savingAdmin  = ref(false)

// ── Optional components ────────────────────────────────────────────────────
interface ComponentDef { name: string; label: string; description: string; installed: boolean }
const components       = ref<ComponentDef[]>([])
const loadingComponents = ref(false)
const nativeMode       = ref(false)
const installing       = ref<string | null>(null)

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
  { key: 'RCLONE_GDRIVE_REMOTE',   label: 'Google Drive Remote',  placeholder: 'gdrive',   hint: 'Rclone remote name for Google Drive (leave blank to disable)' },
  { key: 'RCLONE_ONEDRIVE_REMOTE', label: 'OneDrive Remote',      placeholder: 'onedrive', hint: 'Rclone remote name for OneDrive (leave blank to disable)' },
]

const remoteFields: Field[] = [
  { key: 'TAILSCALE_AUTH_KEY',      label: 'Tailscale Auth Key',      secret: true, hint: 'Optional alternative to "Connect via Browser" above — useful for unattended re-provisioning.' },
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
    authEnabled.value = (patch.value['PORTAL_AUTH'] ?? 'false').toLowerCase() === 'true'
    adminUser.value   = patch.value['PORTAL_USER'] ?? ''
  } catch {
    toast.error('Could not load settings')
  } finally {
    loading.value = false
  }
  fetchComponents()
})

// ── Auth toggle ────────────────────────────────────────────────────────────
async function toggleAuth() {
  savingAuth.value = true
  const next = !authEnabled.value
  try {
    const r = await fetch('/api/v1/settings', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ PORTAL_AUTH: next ? 'true' : 'false' }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    authEnabled.value = next
    toast.success(next ? 'Login required' : 'Login disabled')
  } catch (err) {
    toast.error('Could not update auth', err instanceof Error ? err.message : String(err))
  } finally {
    savingAuth.value = false
  }
}

// ── Save admin credentials ─────────────────────────────────────────────────
async function saveAdmin() {
  savingAdmin.value = true
  try {
    const body: Record<string, string> = { PORTAL_PASS: adminPass.value }
    if (adminUser.value.trim()) body['PORTAL_USER'] = adminUser.value.trim()
    const r = await fetch('/api/v1/settings', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    adminPass.value = ''
    toast.success('Credentials saved')
  } catch (err) {
    toast.error('Save failed', err instanceof Error ? err.message : String(err))
  } finally {
    savingAdmin.value = false
  }
}

// ── Fetch optional components ──────────────────────────────────────────────
async function fetchComponents() {
  loadingComponents.value = true
  try {
    const r = await fetch('/api/v1/services/components')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json() as { components: ComponentDef[]; native: boolean }
    components.value = data.components
    nativeMode.value  = data.native
  } catch { /* silent */ } finally {
    loadingComponents.value = false
  }
}

async function installComponent(name: string) {
  installing.value = name
  const comp = components.value.find(c => c.name === name)
  try {
    const r = await fetch(`/api/v1/services/components/${name}/install`, { method: 'POST' })
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Install failed' })) as { error?: string }
      throw new Error(err.error ?? 'Install failed')
    }
    toast.success(`${comp?.label ?? name} installed`)
    await fetchComponents()
  } catch (err) {
    toast.error('Install failed', err instanceof Error ? err.message : String(err))
  } finally {
    installing.value = null
  }
}

// ── Save a group of fields ─────────────────────────────────────────────────
async function saveGroup(groupName: string, fields: Field[]) {
  savingGroup.value = groupName
  const REDACT = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' // ••••••••
  const groupPatch: Record<string, string> = {}
  for (const f of fields) {
    const v = patch.value[f.key]
    if (v === undefined) continue
    // Don't send the server-side redact placeholder back — it means the user
    // hasn't touched this secret field, so leave the stored value alone.
    if (f.secret && v === REDACT) continue
    groupPatch[f.key] = v
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
