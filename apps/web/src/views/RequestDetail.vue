<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { RequestEvent } from '@ai-approval/shared'
import { ApiError, api } from '../api'
import ActionButtons from '../components/ActionButtons.vue'
import PolicyPanel from '../components/PolicyPanel.vue'
import ReviewPanel from '../components/ReviewPanel.vue'
import { ERROR_LABEL, EVENT_LABEL, STATUS_LABEL } from '../labels'
import { currentUser } from '../session'
import type { PolicyChunk, RequestDetail } from '../types'

const props = defineProps<{ id: string }>()

const request = ref<RequestDetail | null>(null)
const policies = ref<PolicyChunk[]>([])
const activeCitation = ref<string | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const reviewing = computed(() => request.value?.status === 'reviewing')

async function load() {
  request.value = await api.getRequest(props.id)
}

// 輪詢：AI 在背景跑，前端每秒問一次「好了沒」，好了就停
// 這是最簡單的做法；之後會改成 SSE，讓後端主動推播，連預審過程都能即時串流出來
let timer: ReturnType<typeof setInterval> | undefined
function startPolling() {
  stopPolling()
  timer = setInterval(async () => {
    await load()
    if (!reviewing.value) stopPolling()
  }, 1000)
}
function stopPolling() {
  if (timer) clearInterval(timer)
  timer = undefined
}

async function send(event: RequestEvent) {
  busy.value = true
  error.value = null
  try {
    await api.sendEvent(props.id, event)
    await load()
    if (reviewing.value) startPolling()
  } catch (e) {
    error.value = e instanceof ApiError ? (ERROR_LABEL[e.reason] ?? e.message) : String(e)
  } finally {
    busy.value = false
  }
}

const canAct = computed(
  () =>
    currentUser.value.role === 'approver' ||
    request.value?.applicantId === currentUser.value.id,
)

onMounted(async () => {
  const [, p] = await Promise.all([load(), api.listPolicies()])
  policies.value = p
  if (reviewing.value) startPolling()
})
// 離開頁面一定要清掉計時器，不然會在背景一直打 API
onUnmounted(stopPolling)

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-TW', { hour12: false })
}
</script>

<template>
  <p v-if="!request" class="text-muted">載入中……</p>

  <!-- 寬螢幕時左 3 右 2 並排；items-start 讓右邊的 sticky 面板正常運作 -->
  <div v-else class="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <div class="grid gap-4">
      <section class="card">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-semibold">{{ request.title }}</h2>
          <span class="badge">{{ STATUS_LABEL[request.status] }}</span>
        </div>
        <p class="mt-1 text-sm text-muted">
          申請人 {{ request.applicantId }} · 第 {{ request.version }} 版
        </p>
        <p class="my-4 leading-relaxed whitespace-pre-wrap">
          {{ request.description || '（未填寫說明）' }}
        </p>

        <ActionButtons
          v-if="canAct"
          :status="request.status"
          :role="currentUser.role"
          :busy="busy"
          @send="send"
        />
        <p v-if="error" class="mt-3 text-sm text-danger">{{ error }}</p>
      </section>

      <ReviewPanel
        :review="request.review"
        :reviewing="reviewing"
        :active-citation="activeCitation"
        @cite="activeCitation = $event"
      />

      <section class="card">
        <h3 class="mb-3 font-semibold">簽核紀錄</h3>
        <ol class="grid gap-2">
          <li
            v-for="h in request.history"
            :key="h.id"
            class="grid grid-cols-[160px_auto_1fr] gap-3 text-sm"
          >
            <span class="text-muted">{{ formatTime(h.at) }}</span>
            <strong>{{ EVENT_LABEL[h.event] }}</strong>
            <span class="text-muted">{{ h.actor.role === 'system' ? 'AI' : h.actor.id }}</span>
          </li>
        </ol>
      </section>
    </div>

    <PolicyPanel :policies="policies" :active-citation="activeCitation" />
  </div>
</template>
