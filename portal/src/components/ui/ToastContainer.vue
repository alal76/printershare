<!-- Beta test version v1.2.0 -->
<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 pointer-events-none">
      <TransitionGroup
        name="toast"
        tag="div"
        class="flex flex-col gap-2"
      >
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="pointer-events-auto rounded-xl shadow-lg border p-4 bg-white flex items-start gap-3"
          :class="borderClass(toast.kind)"
        >
          <component
            :is="iconFor(toast.kind)"
            class="w-4 h-4 mt-0.5 flex-shrink-0"
            :class="iconColorClass(toast.kind)"
          />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900">
              {{ toast.title }}
            </p>
            <p
              v-if="toast.message"
              class="text-xs text-gray-500 mt-0.5"
            >
              {{ toast.message }}
            </p>
          </div>
          <button
            type="button"
            class="text-gray-400 hover:text-gray-600"
            @click="store.remove(toast.id)"
          >
            <XIcon class="w-4 h-4" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed }     from 'vue'
import { CheckCircleIcon, AlertTriangleIcon, XCircleIcon, InfoIcon, XIcon } from 'lucide-vue-next'
import { useToastStore } from '@/stores/toast'

const store  = useToastStore()
const toasts = computed(() => store.toasts)

function iconFor(kind: string) {
  return { success: CheckCircleIcon, warning: AlertTriangleIcon, error: XCircleIcon, info: InfoIcon }[kind] ?? InfoIcon
}
function borderClass(kind: string) {
  return { success: 'border-green-100', warning: 'border-yellow-100', error: 'border-red-100', info: 'border-blue-100' }[kind] ?? 'border-gray-100'
}
function iconColorClass(kind: string) {
  return { success: 'text-green-500', warning: 'text-yellow-500', error: 'text-red-500', info: 'text-blue-500' }[kind] ?? 'text-gray-400'
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from  { opacity: 0; transform: translateX(100%); }
.toast-leave-to    { opacity: 0; transform: translateX(100%); }
</style>
