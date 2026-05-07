<template>
  <div class="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center">
          <LockIcon class="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 class="text-lg font-semibold text-gray-900">
            Sign in to PrinterShare
          </h1>
          <p class="text-xs text-gray-500">
            Session authentication required
          </p>
        </div>
      </div>

      <form
        class="space-y-4"
        @submit.prevent="onSubmit"
      >
        <div>
          <label
            for="username"
            class="block text-xs font-medium text-gray-700 mb-1"
          >Username</label>
          <input
            id="username"
            v-model="username"
            type="text"
            autocomplete="username"
            class="w-full rounded-xl border-gray-200 text-sm"
            required
          />
        </div>

        <div>
          <label
            for="password"
            class="block text-xs font-medium text-gray-700 mb-1"
          >Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
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
          Sign In
        </Button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { LockIcon } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('admin')
const password = ref('')
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  await auth.refresh()
  if (!auth.authEnabled || auth.authenticated) {
    const nextPath = typeof route.query.next === 'string' ? route.query.next : '/dashboard'
    await router.replace(nextPath)
  }
})

async function onSubmit() {
  loading.value = true
  error.value = ''
  try {
    await auth.login(username.value.trim(), password.value)
    const nextPath = typeof route.query.next === 'string' ? route.query.next : '/dashboard'
    await router.replace(nextPath)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}
</script>
