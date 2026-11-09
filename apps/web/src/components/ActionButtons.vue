<script setup lang="ts">
import { computed } from 'vue'
import { availableEvents, type ActorRole, type RequestEvent, type RequestStatus } from '@ai-approval/shared'
import { EVENT_LABEL } from '../labels'

const props = defineProps<{
  status: RequestStatus
  role: Exclude<ActorRole, 'system'>
  busy: boolean
  // 這張單要不要送部門主管：影響主管按下核准之後的去向（按鈕一樣，結果不同）
  needsPlantManager: boolean
}>()

const emit = defineEmits<{ send: [event: RequestEvent] }>()

const events = computed(() =>
  availableEvents(props.status, props.role, { needsPlantManager: props.needsPlantManager }),
)

</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="event in events"
      :key="event"
      :disabled="busy"
      :class="['btn', { 'btn-primary': event === 'APPROVE' }]"
      @click="emit('send', event)"
    >
      {{ EVENT_LABEL[event] }}
    </button>
  </div>
</template>
