import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const authEnabled = ref(false)
  const authenticated = ref(false)
  const user = ref('')
  const initialized = ref(false)

  async function refresh() {
    try {
      const cfg = await fetch('/api/v1/auth/config')
      if (cfg.ok) {
        const data = await cfg.json() as { authEnabled?: boolean }
        authEnabled.value = Boolean(data.authEnabled)
      }
    } catch {
      authEnabled.value = false
    }

    try {
      const res = await fetch('/api/v1/auth/me')
      if (res.ok) {
        const data = await res.json() as { authenticated?: boolean; user?: string; authEnabled?: boolean }
        authEnabled.value = Boolean(data.authEnabled)
        authenticated.value = Boolean(data.authenticated)
        user.value = data.user || ''
      } else {
        authenticated.value = !authEnabled.value
        user.value = ''
      }
    } catch {
      authenticated.value = !authEnabled.value
      user.value = ''
    } finally {
      initialized.value = true
    }
  }

  async function login(username: string, password: string) {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
      throw new Error(err.error || 'Login failed')
    }
    await refresh()
  }

  async function logout() {
    await fetch('/api/v1/auth/logout', { method: 'POST' })
    authenticated.value = false
    user.value = ''
  }

  return {
    authEnabled,
    authenticated,
    user,
    initialized,
    refresh,
    login,
    logout,
  }
})
