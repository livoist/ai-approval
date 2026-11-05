<script setup lang="ts">
import { computed } from 'vue'
import type { RequestStatus } from '@ai-approval/shared'
import type { AuditEvent } from '../types'

// 簽核路線：這張單會經過哪幾關、現在走到哪、停在哪
// 「要不要經過廠長」跟後端用的是同一個 needsPlantManager，所以畫出來的路線就是實際會走的路線

const props = defineProps<{
  status: RequestStatus
  needsPlantManager: boolean
  history: AuditEvent[]
}>()

type StepKey = 'submit' | 'review' | 'manager' | 'director' | 'done'
type StepState = 'done' | 'current' | 'stopped' | 'upcoming'

// 每個狀態代表「走到第幾關」
const REACHED: Partial<Record<RequestStatus, StepKey>> = {
  draft: 'submit',
  reviewing: 'review',
  pending_approval: 'manager',
  pending_final_approval: 'director',
  approved: 'done',
}

// 中途結束的單（退回、補件、撤回）：從最後一筆紀錄找出「在哪一關、被誰停下來」
const STOP_LABEL = { REJECT: '退回', REQUEST_INFO: '要求補件', WITHDRAW: '撤回' } as const
type StopEvent = keyof typeof STOP_LABEL
const STEP_OF_STATUS: Partial<Record<RequestStatus, StepKey>> = {
  pending_approval: 'manager',
  pending_final_approval: 'director',
}

const steps = computed(() => {
  const keys: StepKey[] = ['submit', 'review', 'manager', ...(props.needsPlantManager ? ['director' as const] : []), 'done']
  const LABEL: Record<StepKey, string> = {
    submit: '送出申請',
    review: 'AI 預審',
    manager: '主管簽核',
    director: '廠長核准',
    done: '核准結案',
  }

  // 找出現在在哪一關，以及是不是「停下來了」
  let at: StepKey = REACHED[props.status] ?? 'submit'
  let stoppedBy: string | null = null
  if (props.status === 'needs_info' || props.status === 'rejected' || props.status === 'withdrawn') {
    const last = [...props.history].reverse().find((h): h is AuditEvent & { event: StopEvent } => h.event in STOP_LABEL)
    if (last) {
      at = (last.from && STEP_OF_STATUS[last.from]) || 'manager'
      stoppedBy = STOP_LABEL[last.event]
    }
  }

  const atIndex = keys.indexOf(at)
  return keys.map((key, i) => {
    let state: StepState
    if (props.status === 'approved') state = 'done'
    else if (i < atIndex) state = 'done'
    else if (i === atIndex) state = stoppedBy ? 'stopped' : 'current'
    else state = 'upcoming'
    return { key, label: LABEL[key], state, note: i === atIndex ? stoppedBy : null }
  })
})

const DOT: Record<StepState, string> = {
  done: 'bg-ok text-white',
  current: 'bg-accent text-white ring-4 ring-accent-soft',
  stopped: 'bg-warning text-white ring-4 ring-warning-soft',
  upcoming: 'bg-surface text-muted ring-1 ring-border',
}
</script>

<template>
  <!-- 手機上放不下就左右捲動，不讓步驟擠成一團 -->
  <ol class="flex overflow-x-auto pb-1" aria-label="簽核路線">
    <li
      v-for="(step, i) in steps"
      :key="step.key"
      class="flex min-w-20 flex-1 flex-col items-center text-center"
      :data-step="step.key"
      :data-state="step.state"
      :aria-current="step.state === 'current' ? 'step' : undefined"
    >
      <div class="flex w-full items-center">
        <!-- 左右的連接線：走過的路是綠色 -->
        <span class="h-0.5 flex-1" :class="i === 0 ? '' : step.state === 'upcoming' ? 'bg-border' : 'bg-ok'" />
        <span class="grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold" :class="DOT[step.state]">
          {{ step.state === 'done' ? '✓' : i + 1 }}
        </span>
        <span
          class="h-0.5 flex-1"
          :class="i === steps.length - 1 ? '' : steps[i + 1]!.state === 'upcoming' ? 'bg-border' : 'bg-ok'"
        />
      </div>
      <span class="mt-1.5 text-xs" :class="step.state === 'upcoming' ? 'text-muted' : 'font-medium'">
        {{ step.label }}
      </span>
      <span v-if="step.note" class="text-xs text-warning">{{ step.note }}</span>
    </li>
  </ol>
</template>
