<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { describeValues, getFormKind, type FormValues, type RequestEvent } from '@ai-approval/shared'
import { ApiError, api } from '../api'
import ActionButtons from '../components/ActionButtons.vue'
import PolicyPanel from '../components/PolicyPanel.vue'
import RequestForm from '../components/RequestForm.vue'
import ReviewPanel from '../components/ReviewPanel.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { ERROR_LABEL, EVENT_LABEL } from '../labels'
import { formatDateTime } from '../time'
import { currentUser } from '../session'
import type { PolicyChunk, RequestDetail, ReviewFinding } from '../types'

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

// 串流：預審期間跟後端保持一條連線，AI 每審出一條意見，後端就主動推過來
// 跟輪詢比起來，不用一直問「好了沒」，而且能看到意見一條一條長出來
const liveFindings = ref<ReviewFinding[]>([])
let streamController: AbortController | null = null

function startStream() {
  stopStream()
  liveFindings.value = []
  const controller = new AbortController()
  streamController = controller

  api
    .streamReview(
      props.id,
      async (event) => {
        if (event.type === 'finding') {
          // 只收目前版本的意見；舊版本晚到的訊息直接丟掉
          if (event.version === request.value?.version) liveFindings.value.push(event.finding)
        } else if (event.status !== 'reviewing') {
          // 預審結束（完成或失敗）：關掉連線，重新載入以後端存下的正式結果為準
          stopStream()
          await load()
        }
      },
      controller.signal,
    )
    .catch(() => {
      // 我們自己 abort 的不算錯誤；其他的才是真的斷線
      if (!controller.signal.aborted) error.value = '即時連線中斷，請重新整理頁面'
    })
}

function stopStream() {
  streamController?.abort()
  streamController = null
}

async function send(event: RequestEvent) {
  busy.value = true
  error.value = null
  try {
    await api.sendEvent(props.id, event)
    await load()
    if (reviewing.value) startStream()
  } catch (e) {
    error.value = e instanceof ApiError ? (ERROR_LABEL[e.reason] ?? e.message) : String(e)
  } finally {
    busy.value = false
  }
}

const feedbackBusy = ref(false)

// 主管評價 AI 的某一條意見，送出後重新載入，畫面就會顯示最新的評價
async function giveFeedback(index: number, verdict: 'correct' | 'incorrect', note: string) {
  const review = request.value?.review
  if (!review) return
  feedbackBusy.value = true
  error.value = null
  try {
    await api.giveFeedback(props.id, review.id, index, { verdict, note })
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? (ERROR_LABEL[e.reason] ?? e.message) : String(e)
  } finally {
    feedbackBusy.value = false
  }
}

const canAct = computed(
  () =>
    currentUser.value.role === 'approver' ||
    request.value?.applicantId === currentUser.value.id,
)

// 填寫內容轉成「標籤：值」的清單來顯示，跟 AI 讀到的是同一份
// 用「這張單自己的」表單定義來顯示：設備維修和費用報銷的欄位完全不同
const formDef = computed(() => (request.value ? getFormKind(request.value.formType).def : null))
const details = computed(() =>
  request.value && formDef.value ? describeValues(formDef.value, request.value.fields) : [],
)

// 修改內容：只有申請人本人，在草稿或待補件時可以改（跟後端 updateRequest 的規則一致）
const canEdit = computed(
  () =>
    currentUser.value.role === 'applicant' &&
    request.value?.applicantId === currentUser.value.id &&
    (request.value.status === 'draft' || request.value.status === 'needs_info'),
)
const editing = ref(false)
const fieldErrors = ref<Record<string, string>>({})

async function save(title: string, fields: FormValues) {
  busy.value = true
  error.value = null
  fieldErrors.value = {}
  try {
    await api.updateRequest(props.id, { title, fields })
    await load()
    editing.value = false
  } catch (e) {
    if (e instanceof ApiError) {
      fieldErrors.value = e.fieldErrors
      error.value = ERROR_LABEL[e.reason] ?? e.message
    } else {
      error.value = String(e)
    }
  } finally {
    busy.value = false
  }
}

// 第一次載入失敗（例如網址裡的 id 不存在），顯示錯誤頁而不是一直轉「載入中」
const loadError = ref<string | null>(null)

onMounted(async () => {
  try {
    // 先載入申請單，才知道要拿哪一份規範文件
    await load()
    if (request.value) policies.value = await api.listPolicies(request.value.formType)
    if (reviewing.value) startStream()
  } catch (e) {
    loadError.value =
      e instanceof ApiError && e.reason === 'not_found'
        ? '找不到這張申請單，可能網址有誤。'
        : '無法載入申請單，請確認後端伺服器是否啟動。'
  }
})
// 離開頁面一定要關掉連線，不然後端會一直以為有人在看
onUnmounted(stopStream)

</script>

<template>
  <div v-if="loadError" class="card mx-auto max-w-md py-10 text-center">
    <p class="font-medium">{{ loadError }}</p>
    <RouterLink to="/" class="btn mt-4 inline-block text-sm">回到申請單清單</RouterLink>
  </div>

  <!-- 載入中：骨架畫面的版面跟真正的頁面一樣，資料出現時不會跳動 -->
  <div
    v-else-if="!request"
    class="grid animate-pulse items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
    aria-busy="true"
  >
    <div class="grid gap-4">
      <div class="card grid gap-3">
        <span class="h-6 w-1/2 rounded bg-bg" />
        <span class="h-3 w-1/3 rounded bg-bg" />
        <span class="h-20 rounded bg-bg" />
      </div>
      <div class="card h-40" />
    </div>
    <div class="card h-64" />
  </div>

  <!-- 寬螢幕時左 3 右 2 並排；items-start 讓右邊的 sticky 面板正常運作 -->
  <div v-else class="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <div class="grid gap-4">
      <section class="card">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 class="text-xl font-semibold">{{ request.title }}</h2>
          <StatusBadge :status="request.status" data-testid="status" />
        </div>
        <p class="mt-1 text-sm text-muted">
          {{ formDef?.title }} · 申請人 {{ request.applicantId }} · 第 {{ request.version }} 版
        </p>
        <!-- 修改模式：同一個表單元件，帶入目前的內容 -->
        <div v-if="editing" class="mt-4">
          <RequestForm
            :form-type="request.formType"
            :initial-title="request.title"
            :initial-fields="request.fields"
            submit-label="儲存"
            :busy="busy"
            :server-errors="fieldErrors"
            @submit="save"
            @cancel="editing = false"
          />
        </div>

        <!-- 檢視模式：欄位用「標籤：值」的表格呈現 -->
        <dl v-else class="my-4 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
          <template v-for="d in details" :key="d.label">
            <dt class="text-muted">{{ d.label }}</dt>
            <dd class="whitespace-pre-wrap">{{ d.value }}</dd>
          </template>
        </dl>

        <div v-if="!editing" class="flex flex-wrap items-center gap-2">
          <ActionButtons
            v-if="canAct"
            :status="request.status"
            :role="currentUser.role"
            :busy="busy"
            @send="send"
          />
          <button v-if="canEdit" class="btn" :disabled="busy" @click="editing = true">修改內容</button>
        </div>
        <p v-if="error" class="mt-3 text-sm text-danger">{{ error }}</p>
      </section>

      <ReviewPanel
        :review="request.review"
        :reviewing="reviewing"
        :live-findings="liveFindings"
        :active-citation="activeCitation"
        :can-give-feedback="currentUser.role === 'approver'"
        :feedback-busy="feedbackBusy"
        @cite="activeCitation = $event"
        @feedback="giveFeedback"
      />

      <section class="card">
        <h3 class="mb-3 font-semibold">簽核紀錄</h3>
        <ol class="grid gap-2">
          <!-- 手機上時間獨立一行；寬螢幕時三欄對齊 -->
          <li
            v-for="h in request.history"
            :key="h.id"
            class="grid grid-cols-[auto_1fr] gap-x-3 text-sm sm:grid-cols-[160px_auto_1fr]"
          >
            <span class="col-span-2 text-xs text-muted sm:col-span-1 sm:text-sm">
              {{ formatDateTime(h.at) }}
            </span>
            <strong>{{ EVENT_LABEL[h.event] }}</strong>
            <span class="text-muted">{{ h.actor.role === 'system' ? 'AI' : h.actor.id }}</span>
          </li>
        </ol>
      </section>
    </div>

    <PolicyPanel :policies="policies" :active-citation="activeCitation" />
  </div>
</template>
