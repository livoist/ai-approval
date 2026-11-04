<script setup lang="ts">
import type { RequestStatus } from '@ai-approval/shared'
import { STATUS_LABEL } from '../labels'

defineProps<{ status: RequestStatus }>()

// 狀態的顏色要有「意義」，而不是每個都不一樣就好：
// 藍 = 流程進行中、黃 = 需要申請人處理、綠 = 結束且通過、紅 = 結束但被退回、灰 = 還沒開始或已撤回
// Record<RequestStatus, ...>：shared 新增狀態卻忘了配色，TypeScript 會直接報錯
const STYLE: Record<RequestStatus, string> = {
  draft: 'bg-bg text-muted ring-1 ring-border',
  reviewing: 'bg-accent-soft text-accent',
  pending_approval: 'bg-accent-soft text-accent',
  needs_info: 'bg-warning-soft text-warning',
  approved: 'bg-ok-soft text-ok',
  rejected: 'bg-danger-soft text-danger',
  withdrawn: 'bg-bg text-muted ring-1 ring-border',
}
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
    :class="STYLE[status]"
  >
    <!-- 預審中加一個會閃的小點，提示「正在處理，等一下會變」 -->
    <span v-if="status === 'reviewing'" class="size-1.5 animate-pulse rounded-full bg-current" />
    {{ STATUS_LABEL[status] }}
  </span>
</template>
