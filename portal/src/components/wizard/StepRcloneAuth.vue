<template>
  <div class="space-y-4">
    <h3 class="font-semibold text-gray-900">
      Authenticate Cloud Backup
    </h3>

    <!-- Cloud backup disabled — nothing to do -->
    <div
      v-if="!enabled"
      class="p-4 bg-gray-50 rounded-xl text-sm text-gray-500"
    >
      Cloud backup is disabled — skipping authentication.
    </div>

    <!-- S3: static credential form -->
    <div
      v-else-if="isS3"
      class="space-y-3"
    >
      <p class="text-sm text-gray-500">
        Enter your AWS credentials. They are stored in the rclone config volume (never in the
        .env file).
      </p>
      <div>
        <label
          for="s3-key"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Access Key ID</label>
        <input
          id="s3-key"
          v-model="s3AccessKeyId"
          type="text"
          autocomplete="off"
          placeholder="AKIAIOSFODNN7EXAMPLE"
          class="w-full rounded-xl border-gray-200 text-sm"
        />
      </div>
      <div>
        <label
          for="s3-secret"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Secret Access Key</label>
        <input
          id="s3-secret"
          v-model="s3SecretKey"
          type="password"
          autocomplete="new-password"
          class="w-full rounded-xl border-gray-200 text-sm"
        />
      </div>
      <div>
        <label
          for="s3-region"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Region</label>
        <input
          id="s3-region"
          v-model="s3Region"
          type="text"
          placeholder="us-east-1"
          class="w-full rounded-xl border-gray-200 text-sm"
        />
      </div>

      <div class="flex gap-2 pt-1">
        <Button
          :loading="busy"
          :disabled="done || !s3AccessKeyId.trim() || !s3SecretKey.trim()"
          @click="authenticate"
        >
          Save S3 Credentials
        </Button>
        <Button
          variant="ghost"
          @click="skip"
        >
          Skip (do later)
        </Button>
      </div>

      <ResultBanner
        v-if="resultMsg"
        :ok="resultOk"
        :message="resultMsg"
      />
    </div>

    <!-- OAuth providers: paste-token flow -->
    <div
      v-else
      class="space-y-3"
    >
      <p class="text-sm text-gray-500">
        Run the following command on <strong>any machine that has a browser</strong> (your laptop,
        desktop, or the server itself via SSH). Once you've authorised {{ providerLabel }}, rclone
        will print a token JSON — paste it below.
      </p>

      <div class="bg-gray-900 rounded-xl px-4 py-3 font-mono text-xs text-green-400 select-all">
        rclone authorize "{{ rcloneTypeName }}"
      </div>

      <p class="text-xs text-gray-400">
        Don't have rclone locally?
        <a
          href="https://rclone.org/install/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary-600 underline"
        >Download rclone →</a>
      </p>

      <div>
        <label
          for="rclone-token"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Token JSON (paste rclone output here)</label>
        <textarea
          id="rclone-token"
          v-model="tokenJson"
          rows="4"
          autocomplete="off"
          spellcheck="false"
          placeholder='{"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}'
          class="w-full rounded-xl border-gray-200 text-xs font-mono resize-none"
        />
      </div>

      <div class="flex gap-2 pt-1">
        <Button
          :loading="busy"
          :disabled="done || !tokenJson.trim()"
          @click="authenticate"
        >
          Save &amp; Verify Connection
        </Button>
        <Button
          variant="ghost"
          @click="skip"
        >
          Skip (do later)
        </Button>
      </div>

      <ResultBanner
        v-if="resultMsg"
        :ok="resultOk"
        :message="resultMsg"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineComponent, h, onMounted } from 'vue'
import Button from '@/components/ui/Button.vue'

/* ── inline micro-component so we don't add a file for a one-liner ─────── */
const ResultBanner = defineComponent({
  props: { ok: Boolean, message: String },
  setup(props) {
    return () => h(
      'p',
      {
        class: [
          'p-3 rounded-xl text-sm',
          props.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700',
        ],
      },
      props.message,
    )
  },
})

const props = defineProps<{ config: Record<string, string> }>()
const emit  = defineEmits<{
  (e: 'update:config', v: Record<string, string>): void
  (e: 'valid', v: boolean): void
}>()

const enabled  = computed(() => props.config.RCLONE_ENABLED === '1')
const provider = computed(() => props.config.RCLONE_PROVIDER || 'dropbox')
const isS3     = computed(() => provider.value === 's3')

const PROVIDER_LABELS: Record<string, string> = {
  dropbox: 'Dropbox',
  gdrive:  'Google Drive',
  onedrive: 'Microsoft OneDrive',
  s3: 'Amazon S3',
}
const RCLONE_TYPES: Record<string, string> = {
  dropbox: 'dropbox',
  gdrive:  'drive',
  onedrive: 'onedrive',
}

const providerLabel  = computed(() => PROVIDER_LABELS[provider.value] ?? provider.value)
const rcloneTypeName = computed(() => RCLONE_TYPES[provider.value] ?? provider.value)

const tokenJson     = ref('')
const s3AccessKeyId = ref('')
const s3SecretKey   = ref('')
const s3Region      = ref('us-east-1')
const busy          = ref(false)
const done          = ref(false)
const resultMsg     = ref('')
const resultOk      = ref(false)

function skip() {
  emit('valid', true)
}

async function authenticate() {
  busy.value = true
  resultMsg.value = ''
  try {
    const body: Record<string, unknown> = { provider: provider.value }
    if (isS3.value) {
      body.s3Config = {
        accessKeyId:     s3AccessKeyId.value.trim(),
        secretAccessKey: s3SecretKey.value,
        region:          s3Region.value.trim() || 'us-east-1',
      }
    } else {
      const raw = tokenJson.value.trim()
      // Validate it looks like JSON before sending
      JSON.parse(raw)
      body.token = raw
    }
    const r = await fetch('/api/v1/wizard/rclone-auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const data = await r.json() as { ok?: boolean; error?: string; detail?: string }
    if (data.ok) {
      resultOk.value  = true
      resultMsg.value = `${providerLabel.value} configured successfully (remote: ${RCLONE_TYPES[provider.value] === 'drive' ? 'gdrive' : provider.value})`
      done.value = true
      emit('valid', true)
    } else {
      resultOk.value  = false
      resultMsg.value = data.error ?? 'Authentication failed'
      if (data.detail) resultMsg.value += ` — ${data.detail}`
    }
  } catch (err: unknown) {
    resultOk.value  = false
    resultMsg.value = err instanceof Error ? err.message : 'Network error or invalid token JSON'
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  if (!enabled.value) emit('valid', true)
})
</script>
