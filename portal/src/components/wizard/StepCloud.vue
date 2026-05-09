<template>
  <div class="space-y-4">
    <h3 class="font-semibold text-gray-900">
      Cloud Backup (Optional)
    </h3>
    <p class="text-sm text-gray-500">
      Enable automatic scan backup to Dropbox, Google Drive, OneDrive, or S3.
    </p>

    <div class="flex items-center gap-3">
      <input
        id="cloud-enable"
        v-model="enabled"
        type="checkbox"
        class="rounded border-gray-300 text-primary-600"
        @change="update"
      />
      <label
        for="cloud-enable"
        class="text-sm text-gray-700"
      >Enable cloud backup</label>
    </div>

    <div
      v-if="enabled"
      class="space-y-3"
    >
      <div>
        <label
          for="cloud-type"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Provider</label>
        <select
          id="cloud-type"
          v-model="provider"
          class="w-full rounded-xl border-gray-200 text-sm"
          @change="update"
        >
          <option value="dropbox">
            Dropbox
          </option>
          <option value="gdrive">
            Google Drive
          </option>
          <option value="onedrive">
            OneDrive
          </option>
          <option value="s3">
            Amazon S3
          </option>
        </select>
      </div>
      <div>
        <label
          for="cloud-bucket"
          class="block text-xs font-medium text-gray-700 mb-1"
        >Bucket / Remote Path</label>
        <input
          id="cloud-bucket"
          v-model="bucket"
          type="text"
          placeholder="my-bucket/scans"
          class="w-full rounded-xl border-gray-200 text-sm"
          @input="update"
        />
      </div>
      <p class="text-xs text-amber-600 p-3 bg-amber-50 rounded-xl">
        After setup, run <code class="font-mono">make rclone-auth</code> to authenticate rclone with your provider.
      </p>
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

const enabled  = ref(Boolean(props.config.RCLONE_REMOTE))
const provider = ref(props.config.RCLONE_PROVIDER || 'dropbox')
const bucket   = ref(props.config.RCLONE_BUCKET   || '')

function update() {
  emit('update:config', {
    ...props.config,
    RCLONE_ENABLED:  enabled.value ? '1' : '0',
    RCLONE_PROVIDER: provider.value,
    RCLONE_BUCKET:   bucket.value,
  })
  emit('valid', true)
}
onMounted(update)
</script>
