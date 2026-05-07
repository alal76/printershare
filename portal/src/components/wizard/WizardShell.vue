<template>
  <div class="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden">
      <!-- Header -->
      <div class="bg-primary-600 p-6 text-white">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
            <PrinterIcon class="w-4 h-4" />
          </div>
          <span class="font-semibold">PrinterShare Setup</span>
        </div>
        <!-- Step dots -->
        <div class="flex items-center gap-2">
          <template
            v-for="(_, i) in steps"
            :key="i"
          >
            <div
              class="flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold transition-all"
              :class="stepDotClass(i)"
            >
              <CheckIcon
                v-if="i < currentStep"
                class="w-3.5 h-3.5"
              />
              <span v-else>{{ i + 1 }}</span>
            </div>
            <div
              v-if="i < steps.length - 1"
              class="flex-1 h-0.5 rounded"
              :class="i < currentStep ? 'bg-white' : 'bg-white/30'"
            ></div>
          </template>
        </div>
        <p class="text-white/80 text-sm mt-3">
          Step {{ currentStep + 1 }} of {{ steps.length }}: {{ steps[currentStep] }}
        </p>
      </div>

      <!-- Step content -->
      <div class="p-6">
        <component
          :is="stepComponents[currentStep]"
          v-model:config="config"
          @valid="isValid = $event"
        />
      </div>

      <!-- Footer nav -->
      <div class="px-6 pb-6 flex items-center justify-between">
        <Button
          variant="ghost"
          :disabled="currentStep === 0"
          @click="prev"
        >
          <ChevronLeftIcon class="w-4 h-4" /> Back
        </Button>
        <Button
          v-if="currentStep < steps.length - 1"
          :disabled="!isValid"
          @click="next"
        >
          Next <ChevronRightIcon class="w-4 h-4" />
        </Button>
        <Button
          v-else
          :loading="building"
          @click="finish"
        >
          <RocketIcon class="w-4 h-4" /> Launch
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import { useRouter }       from 'vue-router'
import { PrinterIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, RocketIcon } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { useSystemStore } from '@/stores/system'
import { useToastStore }  from '@/stores/toast'

import StepPrereqs  from './StepPrereqs.vue'
import StepUsbDetect from './StepUsbDetect.vue'
import StepPasswords from './StepPasswords.vue'
import StepNetwork   from './StepNetwork.vue'
import StepCloud     from './StepCloud.vue'
import StepRemote    from './StepRemote.vue'
import StepConfirm   from './StepConfirm.vue'

const steps = [
  'Check Prerequisites',
  'Detect USB Device',
  'Set Passwords',
  'Network Options',
  'Cloud Backup',
  'Remote Access',
  'Review & Build',
]

const stepComponents = shallowRef([
  StepPrereqs, StepUsbDetect, StepPasswords, StepNetwork, StepCloud, StepRemote, StepConfirm,
])

const router   = useRouter()
const system   = useSystemStore()
const toast    = useToastStore()
const currentStep = ref(0)
const isValid  = ref(true)
const building = ref(false)
const config   = ref<Record<string, string>>({})

function stepDotClass(i: number) {
  if (i < currentStep.value) return 'bg-white text-primary-600'
  if (i === currentStep.value) return 'bg-white text-primary-600 ring-2 ring-white ring-offset-2 ring-offset-primary-600'
  return 'bg-white/30 text-white'
}

async function saveStep() {
  await fetch('/api/v1/wizard/state', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ step: currentStep.value, data: config.value }),
  })
}

async function next() {
  await saveStep()
  currentStep.value++
  isValid.value = true
}

async function prev() {
  await saveStep()
  currentStep.value--
}

async function finish() {
  building.value = true
  try {
    const r = await fetch('/api/v1/wizard/build', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ config: config.value }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    system.wizardCompleted = true
    toast.success('Setup complete!', 'Services are starting up.')
    await router.push('/dashboard')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    toast.error('Build failed', msg)
  } finally {
    building.value = false
  }
}
</script>
