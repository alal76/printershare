<template>
  <header class="h-14 border-b border-gray-100 bg-white flex items-center justify-between px-4 lg:px-8 flex-shrink-0">
    <h1 class="text-base font-semibold text-gray-900">
      {{ title ?? currentTitle }}
    </h1>

    <div class="flex items-center gap-2">
      <!-- Service status dots -->
      <div
        v-for="(svc, key) in topServices"
        :key="key"
        :title="String(key)"
        class="w-2 h-2 rounded-full"
        :class="dotClass(svc.status)"
      ></div>
      <!-- Settings link (mobile) -->
      <RouterLink
        to="/settings"
        class="lg:hidden p-1.5 text-gray-500 hover:text-gray-900"
      >
        <SettingsIcon class="w-5 h-5" />
      </RouterLink>
      <button
        v-if="auth.authEnabled"
        type="button"
        class="p-1.5 text-gray-500 hover:text-gray-900"
        title="Sign out"
        @click="onLogout"
      >
        <LogOutIcon class="w-5 h-5" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed }     from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SettingsIcon, LogOutIcon } from 'lucide-vue-next'
import { useSystemStore } from '@/stores/system'
import { useAuthStore } from '@/stores/auth'

defineProps<{ title?: string }>()

const route  = useRoute()
const router = useRouter()
const system = useSystemStore()
const auth = useAuthStore()

const routeTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/devices':   'Devices',
  '/scan':      'Scan',
  '/print':     'Print',
  '/sharing':   'Sharing',
  '/docs':      'Documents',
  '/settings':  'Settings',
}
const currentTitle = computed(() => routeTitles[route.path] ?? 'PrinterShare')

const topServices = computed(() => {
  const svcs = system.health?.services ?? {}
  return Object.fromEntries(Object.entries(svcs).slice(0, 5))
})

function dotClass(status: string) {
  return {
    'bg-green-500':  status === 'ok',
    'bg-red-500':    status === 'error',
    'bg-yellow-400': status === 'offline',
    'bg-gray-300':   !status || status === 'unknown',
  }
}

async function onLogout() {
  await auth.logout()
  await router.push('/login')
}
</script>
