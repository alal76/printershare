<template>
  <nav class="w-60 flex-col flex-shrink-0 border-r border-gray-100 bg-white p-4 gap-0.5">
    <!-- Logo -->
    <div class="flex items-center gap-2.5 px-3 py-2 mb-5">
      <div class="w-8 h-8 rounded-xl bg-primary-600 flex items-center justify-center">
        <PrinterIcon class="w-4 h-4 text-white" />
      </div>
      <span class="font-semibold text-gray-900 text-sm">PrinterShare</span>
    </div>

    <!-- Main nav -->
    <div class="space-y-0.5 flex-1">
      <p class="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
        Overview
      </p>
      <RouterLink
        v-for="link in mainLinks"
        :key="link.to"
        :to="link.to"
        class="sidebar-link"
        :class="{ active: isActive(link.to) }"
      >
        <component
          :is="link.icon"
          class="w-4 h-4 flex-shrink-0"
        />
        {{ link.label }}
      </RouterLink>

      <p class="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-1">
        Manage
      </p>
      <RouterLink
        v-for="link in manageLinks"
        :key="link.to"
        :to="link.to"
        class="sidebar-link"
        :class="{ active: isActive(link.to) }"
      >
        <component
          :is="link.icon"
          class="w-4 h-4 flex-shrink-0"
        />
        {{ link.label }}
      </RouterLink>
    </div>

    <div class="mt-auto pt-4 border-t border-gray-100 space-y-0.5">
      <RouterLink
        to="/settings"
        class="sidebar-link"
        :class="{ active: isActive('/settings') }"
      >
        <SettingsIcon class="w-4 h-4" /> Settings
      </RouterLink>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import {
  PrinterIcon, ScanIcon, FileTextIcon, LayoutDashboardIcon,
  SettingsIcon, UsbIcon, ShareIcon,
} from 'lucide-vue-next'

const route = useRoute()

const mainLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboardIcon },
]

const manageLinks = [
  { to: '/devices',  label: 'Devices',    icon: UsbIcon },
  { to: '/scan',     label: 'Scan',       icon: ScanIcon },
  { to: '/print',    label: 'Print',      icon: PrinterIcon },
  { to: '/sharing',  label: 'Sharing',    icon: ShareIcon },
  { to: '/docs',     label: 'Documents',  icon: FileTextIcon },
]

function isActive(path: string) {
  return route.path === path || route.path.startsWith(path + '/')
}
</script>
