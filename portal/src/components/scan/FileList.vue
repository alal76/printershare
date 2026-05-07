<template>
  <div>
    <div v-if="scanStore.isLoading" class="space-y-2">
      <div v-for="i in 3" :key="i" class="h-12 bg-gray-100 rounded-xl animate-pulse" />
    </div>
    <div v-else-if="files.length === 0" class="text-center py-10 text-gray-400 text-sm border border-dashed rounded-xl">
      No scanned files yet
    </div>
    <div v-else class="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden bg-white">
      <div
        v-for="file in displayFiles"
        :key="file.name"
        class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div class="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
          <component :is="fileIcon(file.mimeType)" class="w-4 h-4 text-primary-600" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate">{{ file.name }}</p>
          <p class="text-xs text-gray-400">{{ formatSize(file.size) }} · {{ formatDate(file.date) }}</p>
        </div>
        <div class="flex items-center gap-1">
          <a :href="file.url" download class="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-primary-50 transition-colors" :title="`Download ${file.name}`">
            <DownloadIcon class="w-4 h-4" />
          </a>
          <button class="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors" :title="`Delete ${file.name}`" @click="confirmDelete(file.name)">
            <Trash2Icon class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed }       from 'vue'
import { DownloadIcon, Trash2Icon, FileTextIcon, ImageIcon, FileIcon } from 'lucide-vue-next'
import { useScanStore }   from '@/stores/scan'
import { useToastStore }  from '@/stores/toast'

const props = withDefaults(defineProps<{ max?: number }>(), { max: 100 })
const scanStore = useScanStore()
const toast     = useToastStore()

const files       = computed(() => scanStore.files)
const displayFiles = computed(() => files.value.slice(0, props.max))

function fileIcon(mimeType: string) {
  if (mimeType === 'application/pdf')     return FileTextIcon
  if (mimeType.startsWith('image/'))      return ImageIcon
  return FileIcon
}

function formatSize(bytes: number) {
  if (bytes < 1024)         return `${bytes} B`
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function confirmDelete(name: string) {
  if (!globalThis.confirm(`Delete "${name}"?`)) return
  try {
    await scanStore.deleteFile(name)
    toast.success('File deleted')
  } catch {
    toast.error('Delete failed')
  }
}
</script>
