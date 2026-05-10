import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

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
    path: '/login',
    component: () => import('@/views/LoginView.vue'),
    meta: { plain: true, public: true },
  },
  {
    path: '/change-password',
    component: () => import('@/views/ChangePasswordView.vue'),
    meta: { plain: true, title: 'Change Password' },
  },
  {
    path: '/dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { title: 'Dashboard' },
  },
  {
    path: '/devices',
    component: () => import('@/views/DevicesView.vue'),
    meta: { title: 'Devices' },
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
    path: '/sharing',
    component: () => import('@/views/SharingView.vue'),
    meta: { title: 'Sharing' },
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

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.initialized) {
    await auth.refresh()
  }

  if (!auth.authEnabled) {
    if (to.path === '/login') return '/dashboard'
    return true
  }

  const isPublic = Boolean(to.meta.public)
  if (!auth.authenticated && !isPublic) {
    return { path: '/login', query: { next: to.fullPath } }
  }
  if (auth.authenticated && to.path === '/login') {
    return '/dashboard'
  }
  // Force password change before any other page.
  if (auth.authenticated && auth.mustChangePassword && to.path !== '/change-password') {
    return '/change-password'
  }
  return true
})
