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
          :build-logs="buildLogs"
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

import StepPrereqs    from './StepPrereqs.vue'
import StepUsbDetect  from './StepUsbDetect.vue'
import StepPasswords  from './StepPasswords.vue'
import StepNetwork    from './StepNetwork.vue'
import StepCloud      from './StepCloud.vue'
import StepRcloneAuth from './StepRcloneAuth.vue'
import StepRemote     from './StepRemote.vue'
import StepConfirm    from './StepConfirm.vue'

const steps = [
  'Check Prerequisites',
  'Detect USB Device',
  'Set Passwords',
  'Network Options',
  'Cloud Backup',
  'Authenticate Cloud',
  'Remote Access',
  'Review & Build',
]

const stepComponents = shallowRef([
  StepPrereqs, StepUsbDetect, StepPasswords, StepNetwork, StepCloud,
  StepRcloneAuth, StepRemote, StepConfirm,
])

const router   = useRouter()
const system   = useSystemStore()
const toast    = useToastStore()
const currentStep = ref(0)
const isValid  = ref(true)
const building = ref(false)
const config   = ref<Record<string, string>>({})
const buildLogs = ref<string[]>([])

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

type BuildEvent = { type?: string; data?: string }

function parseSseChunk(chunk: string): BuildEvent | null {
  const line = chunk.split('\n').find(l => l.startsWith('data: '))
  if (!line) return null
  return JSON.parse(line.slice(6)) as BuildEvent
}

function handleBuildEvent(evt: BuildEvent): boolean {
  if (evt.type === 'log' && evt.data) {
    buildLogs.value.push(evt.data)
  }
  if (evt.type === 'error') {
    buildLogs.value.push(`ERROR: ${evt.data ?? 'Build failed'}`)
    const tail = buildLogs.value.slice(-30).join('\n')
    throw new Error(tail)
  }
  return evt.type === 'complete'
}

async function consumeBuildStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<boolean> {
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''

    for (const chunk of chunks) {
      const evt = parseSseChunk(chunk)
      if (!evt) continue
      completed = handleBuildEvent(evt) || completed
    }
  }

  return completed
}

async function finish() {
  building.value = true
  buildLogs.value = []
  try {
    const r = await fetch('/api/v1/wizard/build', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ config: config.value }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)

    const reader = r.body?.getReader()
    if (!reader) throw new Error('No build stream received')

    const completed = await consumeBuildStream(reader)

    if (!completed) throw new Error('Build did not complete successfully')

    system.wizardCompleted = true
    toast.success('Setup complete!', 'Services started successfully.')
    await router.push('/dashboard')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // Show a short summary in the toast; full log is visible in the panel below
    const summary = msg.split('\n').slice(-3).join(' | ')
    toast.error('Build failed', summary)
  } finally {
    building.value = false
  }
}
</script>
