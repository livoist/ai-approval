<script setup lang="ts">
import { computed } from 'vue'
import { availableEvents, type RequestEvent, type RequestStatus } from '@ai-approval/shared'
import { EVENT_LABEL } from '../labels'

const props = defineProps<{
  status: RequestStatus
  role: 'applicant' | 'approver'
  busy: boolean
}>()

const emit = defineEmits<{ send: [event: RequestEvent] }>()

const events = computed(() => availableEvents(props.status, props.role))

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
