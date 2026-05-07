import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

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
