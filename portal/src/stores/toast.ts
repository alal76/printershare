import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id:       string
  kind:     ToastKind
  title:    string
  message?: string
  duration: number
}

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])

  function add(toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const t: Toast = { duration: 4000, ...toast, id }
    toasts.value.push(t)
    if (t.duration > 0) {
      setTimeout(() => remove(id), t.duration)
    }
    return id
  }

  function remove(id: string) {
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx >= 0) toasts.value.splice(idx, 1)
  }

  const success = (title: string, message?: string) => add({ kind: 'success', title, message, duration: 4000 })
  const error   = (title: string, message?: string) => add({ kind: 'error',   title, message, duration: 6000 })
  const warn    = (title: string, message?: string) => add({ kind: 'warning', title, message, duration: 5000 })
  const info    = (title: string, message?: string) => add({ kind: 'info',    title, message, duration: 4000 })

  return { toasts, add, remove, success, error, warn, info }
})
