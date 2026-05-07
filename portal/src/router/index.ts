import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useSystemStore } from '@/stores/system'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/wizard',
    component: () => import('@/views/WizardView.vue'),
    meta: { plain: true },
  },
  {
    path: '/dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { title: 'Dashboard' },
  },
  {
    path: '/scan',
    component: () => import('@/views/ScanView.vue'),
    meta: { title: 'Scan' },
  },
  {
    path: '/print',
    component: () => import('@/views/PrintView.vue'),
    meta: { title: 'Print' },
  },
  {
    path: '/docs',
    component: () => import('@/views/DocsView.vue'),
    meta: { title: 'Documents' },
  },
  {
    path: '/settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: 'Settings' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard',
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Navigation guard: if wizard not completed, send to /wizard
router.beforeEach(async (to) => {
  if (to.meta.plain || to.path === '/wizard') return true
  try {
    const sys = useSystemStore()
    await sys.ensureWizardChecked()
    if (!sys.wizardCompleted) return '/wizard'
  } catch { /* allow navigation on error */ }
  return true
})
