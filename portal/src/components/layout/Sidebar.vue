<template>
  <nav class="w-60 flex-col flex-shrink-0 border-r border-gray-100 bg-white p-4 gap-1">
    <!-- Logo -->
    <div class="flex items-center gap-2.5 px-3 py-2 mb-4">
      <div class="w-8 h-8 rounded-xl bg-primary-600 flex items-center justify-center">
        <PrinterIcon class="w-4 h-4 text-white" />
      </div>
      <span class="font-semibold text-gray-900 text-sm">PrinterShare</span>
    </div>

    <RouterLink
      v-for="link in navLinks"
      :key="link.to"
      :to="link.to"
      class="sidebar-link"
      :class="{ active: isActive(link.to) }"
    >
      <component :is="link.icon" class="w-4 h-4 flex-shrink-0" />
      {{ link.label }}
    </RouterLink>

    <div class="mt-auto pt-4 border-t border-gray-100">
      <RouterLink to="/settings" class="sidebar-link" :class="{ active: isActive('/settings') }">
        <SettingsIcon class="w-4 h-4" /> Settings
      </RouterLink>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useRoute }   from 'vue-router'
import { PrinterIcon, ScanIcon, FileTextIcon, LayoutDashboardIcon, SettingsIcon } from 'lucide-vue-next'

const route = useRoute()

const navLinks = [
  { to: '/dashboard', label: 'Dashboard',  icon: LayoutDashboardIcon },
  { to: '/scan',      label: 'Scan',        icon: ScanIcon },
  { to: '/print',     label: 'Print',       icon: PrinterIcon },
  { to: '/docs',      label: 'Documents',   icon: FileTextIcon },
]

function isActive(path: string) {
  return route.path === path || route.path.startsWith(path + '/')
}
</script>
