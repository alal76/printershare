<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/40 backdrop-blur-sm"
          @click="$emit('update:modelValue', false)"
        ></div>
        <!-- Panel -->
        <dialog
          class="relative bg-white rounded-2xl shadow-xl max-w-lg w-full"
          :class="[$attrs.class]"
          open
        >
          <div class="flex items-start justify-between p-5 border-b border-gray-100">
            <slot name="header">
              <h2 class="text-base font-semibold text-gray-900">
                {{ title }}
              </h2>
            </slot>
            <button
              type="button"
              class="text-gray-400 hover:text-gray-600 p-0.5"
              @click="$emit('update:modelValue', false)"
            >
              <XIcon class="w-5 h-5" />
            </button>
          </div>
          <div class="p-5">
            <slot></slot>
          </div>
          <div
            v-if="$slots.footer"
            class="px-5 pb-5 flex items-center justify-end gap-2"
          >
            <slot name="footer"></slot>
          </div>
        </dialog>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { XIcon } from 'lucide-vue-next'

defineProps<{ modelValue: boolean; title?: string }>()
defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active { transition: all 0.2s ease; }
.modal-enter-from,
.modal-leave-to     { opacity: 0; }
.modal-enter-from > div + div,
.modal-leave-to   > div + div { transform: scale(0.95); }
</style>
