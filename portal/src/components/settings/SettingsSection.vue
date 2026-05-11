<!-- Beta test version v1.2.0 -->
<template>
  <Card>
    <!-- Section header -->
    <div class="flex items-center gap-3 mb-5">
      <div
        class="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
        :class="iconBg"
      >
        <NetworkIcon
          v-if="icon === 'network'"
          class="w-4 h-4"
          :class="iconColor"
        />
        <ShareIcon
          v-else-if="icon === 'share'"
          class="w-4 h-4"
          :class="iconColor"
        />
        <ShieldIcon
          v-else-if="icon === 'shield'"
          class="w-4 h-4"
          :class="iconColor"
        />
        <CloudIcon
          v-else-if="icon === 'cloud'"
          class="w-4 h-4"
          :class="iconColor"
        />
        <GlobeIcon
          v-else-if="icon === 'globe'"
          class="w-4 h-4"
          :class="iconColor"
        />
        <SettingsIcon
          v-else
          class="w-4 h-4"
          :class="iconColor"
        />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-gray-900">
          {{ title }}
        </h2>
        <p class="text-xs text-gray-500">
          {{ description }}
        </p>
      </div>
    </div>

    <!-- Skeleton loaders -->
    <div
      v-if="loading"
      class="space-y-3 mb-4"
    >
      <div
        v-for="i in fields.length"
        :key="i"
        class="h-14 bg-gray-100 rounded-xl animate-pulse"
      ></div>
    </div>

    <!-- Fields -->
    <form
      v-else
      class="space-y-3"
      @submit.prevent="$emit('save')"
    >
      <div
        v-for="f in fields"
        :key="f.key"
      >
        <label
          :for="`setting-${f.key}`"
          class="block text-xs font-medium text-gray-700 mb-1"
        >
          {{ f.label }}
        </label>
        <div class="relative">
          <input
            :id="`setting-${f.key}`"
            :value="patch[f.key] ?? ''"
            :type="revealedKeys.has(f.key) ? 'text' : (f.secret ? 'password' : 'text')"
            autocomplete="off"
            spellcheck="false"
            :placeholder="f.placeholder ?? ''"
            class="w-full rounded-xl border-gray-200 text-sm"
            :class="f.secret ? 'pr-9 font-mono' : ''"
            @input="onInput(f.key, ($event.target as HTMLInputElement).value)"
          />
          <button
            v-if="f.secret"
            type="button"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            :title="revealedKeys.has(f.key) ? 'Hide' : 'Show'"
            @click="toggleReveal(f.key)"
          >
            <EyeOffIcon
              v-if="revealedKeys.has(f.key)"
              class="w-4 h-4"
            />
            <EyeIcon
              v-else
              class="w-4 h-4"
            />
          </button>
        </div>
        <p
          v-if="f.hint"
          class="text-xs text-gray-400 mt-1"
        >
          {{ f.hint }}
        </p>
      </div>

      <div class="pt-1">
        <Button
          type="submit"
          size="sm"
          :loading="saving"
        >
          <SaveIcon class="w-3.5 h-3.5" />
          Save
        </Button>
      </div>
    </form>
  </Card>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  NetworkIcon, ShareIcon, ShieldIcon, CloudIcon, GlobeIcon,
  SettingsIcon, EyeIcon, EyeOffIcon, SaveIcon,
} from 'lucide-vue-next'
import Card   from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'

export interface SettingsField {
  key:         string
  label:       string
  placeholder?: string
  secret?:     boolean
  hint?:       string
}

const props = defineProps<{
  title:       string
  description: string
  icon:        'network' | 'share' | 'shield' | 'cloud' | 'globe' | 'other'
  fields:      SettingsField[]
  patch:       Record<string, string>
  loading?:    boolean
  saving?:     boolean
}>()

const emit = defineEmits<{
  (e: 'save'): void
  (e: 'update:patch', v: Record<string, string>): void
}>()

const revealedKeys = ref(new Set<string>())

function toggleReveal(key: string) {
  if (revealedKeys.value.has(key)) {
    revealedKeys.value.delete(key)
  } else {
    revealedKeys.value.add(key)
  }
}

function onInput(key: string, value: string) {
  emit('update:patch', { ...props.patch, [key]: value })
}

// ── Icon style maps ──────────────────────────────────────────────────────────
const BG_MAP: Record<string, string> = {
  network: 'bg-blue-100',
  share:   'bg-orange-100',
  shield:  'bg-red-100',
  cloud:   'bg-sky-100',
  globe:   'bg-purple-100',
  other:   'bg-gray-100',
}
const COLOR_MAP: Record<string, string> = {
  network: 'text-blue-700',
  share:   'text-orange-700',
  shield:  'text-red-700',
  cloud:   'text-sky-700',
  globe:   'text-purple-700',
  other:   'text-gray-600',
}

const iconBg    = BG_MAP[props.icon]    ?? BG_MAP.other
const iconColor = COLOR_MAP[props.icon] ?? COLOR_MAP.other
</script>
