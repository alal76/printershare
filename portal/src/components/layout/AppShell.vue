<!-- Beta test version v1.2.0 -->
<template>
  <div class="flex h-screen overflow-hidden bg-gray-50">
    <!-- Sidebar (desktop) -->
    <Sidebar class="hidden lg:flex" />

    <!-- Main content -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <TopBar :title="title" />
      <main class="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
        <slot></slot>
      </main>
    </div>
  </div>

  <!-- Bottom nav (mobile) -->
  <BottomNav class="lg:hidden" />
</template>

<script setup lang="ts">
import Sidebar   from '@/components/layout/Sidebar.vue'
import TopBar    from '@/components/layout/TopBar.vue'
import BottomNav from '@/components/layout/BottomNav.vue'

defineProps<{ title?: string }>()
</script>
