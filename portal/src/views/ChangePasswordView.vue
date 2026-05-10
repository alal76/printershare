<template>
  <div class="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
          <KeyIcon class="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 class="text-lg font-semibold text-gray-900">
            Set a new password
          </h1>
          <p class="text-xs text-gray-500">
            You're using the default password. Please change it before continuing.
          </p>
        </div>
      </div>

      <form
        class="space-y-4"
        @submit.prevent="onSubmit"
      >
        <div>
          <label
            for="current"
            class="block text-xs font-medium text-gray-700 mb-1"
          >Current password</label>
          <input
            id="current"
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            class="w-full rounded-xl border-gray-200 text-sm"
            required
          />
        </div>

        <div>
          <label
            for="newpw"
            class="block text-xs font-medium text-gray-700 mb-1"
          >New password</label>
          <input
            id="newpw"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-xl border-gray-200 text-sm"
            required
            minlength="8"
          />
        </div>

        <div>
          <label
            for="confirm"
            class="block text-xs font-medium text-gray-700 mb-1"
          >Confirm new password</label>
          <input
            id="confirm"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-xl border-gray-200 text-sm"
            required
          />
        </div>

        <p
          v-if="error"
          class="text-xs text-red-600"
        >
          {{ error }}
        </p>

        <Button
          type="submit"
          class="w-full"
          :loading="loading"
        >
          Change Password
        </Button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { KeyIcon } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }
  if (newPassword.value.length < 8) {
    error.value = 'Password must be at least 8 characters'
    return
  }
  loading.value = true
  try {
    const res = await fetch('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
      error.value = data.error ?? 'Failed to change password'
      return
    }
    auth.mustChangePassword = false
    await router.push('/dashboard')
  } catch {
    error.value = 'Network error. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>
