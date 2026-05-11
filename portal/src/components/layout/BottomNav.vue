<!-- Beta test version v1.2.0 -->
<template>
  <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 pb-safe z-40">
    <div class="flex items-center justify-around">
      <RouterLink
        v-for="link in navLinks"
        :key="link.to"
        :to="link.to"
        class="flex flex-col items-center gap-0.5 py-2 px-3 text-[10px] font-medium transition-colors"
        :class="isActive(link.to) ? 'text-primary-600' : 'text-gray-500'"
      >
        <component
          :is="link.icon"
          class="w-5 h-5"
        />
        {{ link.label }}
      </RouterLink>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { LayoutDashboardIcon, UsbIcon, ScanIcon, PrinterIcon, ShareIcon } from 'lucide-vue-next'

const route = useRoute()

const navLinks = [
  { to: '/dashboard', label: 'Home',    icon: LayoutDashboardIcon },
  { to: '/devices',   label: 'Devices', icon: UsbIcon },
  { to: '/scan',      label: 'Scan',    icon: ScanIcon },
  { to: '/print',     label: 'Print',   icon: PrinterIcon },
  { to: '/sharing',   label: 'Sharing', icon: ShareIcon },
]

function isActive(path: string) {
  return route.path === path || route.path.startsWith(path + '/')
}
</script>
