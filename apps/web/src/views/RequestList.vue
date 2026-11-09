<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  FORM_TYPES,
  PENDING_STATUS_FOR,
  getFormKind,
  isApproverRole,
  type FormType,
  type FormValues,
} from '@ai-approval/shared'
import { ApiError, api } from '../api'
import RequestForm from '../components/RequestForm.vue'
import RiskBadge from '../components/RiskBadge.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { ERROR_LABEL } from '../labels'
import { currentUser } from '../session'
import { elapsed } from '../time'
import type { RequestSummary } from '../types'

const router = useRouter()
const requests = ref<RequestSummary[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const creating = ref(false)
const error = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})

const isApprover = computed(() => isApproverRole(currentUser.value.role))
const formTitle = (type: FormType) => getFormKind(type).def.title

// ===== 新增申請 =====
// 要建立哪一種申請單：清單來自 shared 的 FORM_TYPES
// 之後新增第三種申請單，這裡會自動多一個分頁，不用改這個檔案
const formType = ref<FormType>('maintenance')

function selectFormType(type: FormType) {
  formType.value = type
  error.value = null
  serverErrors.value = {}
}

async function create(title: string, fields: FormValues) {
  creating.value = true
  error.value = null
  serverErrors.value = {}
  try {
    const r = await api.createRequest({ formType: formType.value, title, fields })
    router.push(`/requests/${r.id}`)
  } catch (e) {
    // 後端的欄位錯誤，交給表單顯示在對應的欄位下
    if (e instanceof ApiError) {
      serverErrors.value = e.fieldErrors
      error.value = ERROR_LABEL[e.reason] ?? e.message
    } else {
      error.value = String(e)
    }
  } finally {
    creating.value = false
  }
}

// ===== 申請單清單 =====
// 篩選依角色不同：主管最常看「待我簽核」，申請人最常看「我的申請」
type Scope = 'mine' | 'all'
const scope = ref<Scope>('mine')
const typeFilter = ref<FormType | 'all'>('all')

const SCOPE_LABEL = computed(() => ({
  mine: isApprover.value ? '待我簽核' : '我的申請',
  all: '全部',
}))

// 主管的「待我簽核」是待直屬主管簽核的單；部門主管的是待部門主管核准的單
const inScope = (r: RequestSummary) =>
  isApprover.value
    ? r.status === PENDING_STATUS_FOR[currentUser.value.role]
    : r.applicantId === currentUser.value.id

// 「待我簽核」的數量顯示在分頁上，主管不用點進去就知道有幾張
const mineCount = computed(() => requests.value.filter(inScope).length)

const RISK_ORDER = { high: 0, medium: 1, low: 2 } as const

const visible = computed(() => {
  const list = requests.value
    .filter((r) => scope.value === 'all' || inScope(r))
    .filter((r) => typeFilter.value === 'all' || r.formType === typeFilter.value)

  // 主管的待簽核：高風險優先，同等級的等越久越前面；其他情況一律最新的在前
  if (isApprover.value && scope.value === 'mine') {
    return list.sort(
      (a, b) =>
        RISK_ORDER[a.riskLevel ?? 'low'] - RISK_ORDER[b.riskLevel ?? 'low'] ||
        a.updatedAt.localeCompare(b.updatedAt),
    )
  }
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
})

const hasFilter = computed(() => scope.value !== 'all' || typeFilter.value !== 'all')

function clearFilters() {
  scope.value = 'all'
  typeFilter.value = 'all'
}

// 空狀態要說明「為什麼是空的」和「接下來可以做什麼」，而不是只有一句「沒有資料」
const empty = computed(() => {
  if (requests.value.length === 0) {
    return isApprover.value
      ? { title: '目前還沒有任何申請單', hint: '申請人送出、完成 AI 預審之後，會出現在這裡。' }
      : { title: '還沒有任何申請單', hint: '從左邊選擇申請類型，點範例資料就能快速建立一張。' }
  }
  if (scope.value === 'mine' && typeFilter.value === 'all') {
    return isApprover.value
      ? { title: '沒有待你簽核的申請單', hint: '新的申請完成 AI 預審後，會出現在這裡。' }
      : { title: '你還沒有建立申請單', hint: '從左邊選擇申請類型開始填寫。' }
  }
  return { title: '沒有符合條件的申請單', hint: '換個篩選條件看看。' }
})

async function load() {
  loading.value = true
  loadError.value = null
  try {
    requests.value = await api.listRequests()
  } catch {
    loadError.value = '無法載入申請單，請確認後端伺服器是否啟動。'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <!-- 手機一欄；寬度 ≥ 1024px（lg 斷點）時左邊固定 440px、右邊吃滿 -->
  <div class="grid items-start gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
    <section v-if="!isApprover" class="card">
      <h2 class="mb-3 text-lg font-semibold">新增申請</h2>

      <div role="tablist" class="mb-4 flex gap-1 rounded-lg bg-bg p-1">
        <button
          v-for="type in FORM_TYPES"
          :key="type"
          role="tab"
          type="button"
          class="flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm"
          :class="type === formType ? 'bg-surface font-semibold shadow-sm' : 'text-muted'"
          :aria-selected="type === formType"
          @click="selectFormType(type)"
        >
          {{ formTitle(type) }}
        </button>
      </div>

      <!-- :key 讓切換類型時整個表單重建，上一種單填到一半的內容不會殘留 -->
      <RequestForm
        :key="formType"
        :form-type="formType"
        submit-label="建立草稿"
        show-samples
        :busy="creating"
        :server-errors="serverErrors"
        @submit="create"
      />
      <p v-if="error" class="mt-3 text-sm text-danger">{{ error }}</p>
    </section>

    <!-- 主管看不到新增區塊，清單就佔滿整個寬度 -->
    <section class="card" :class="{ 'lg:col-span-2': isApprover }">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">申請單</h2>

        <div class="flex flex-wrap items-center gap-2">
          <div class="flex gap-1 rounded-lg bg-bg p-1 text-sm">
            <button
              v-for="s in (['mine', 'all'] as const)"
              :key="s"
              type="button"
              class="cursor-pointer rounded-md px-3 py-1"
              :class="s === scope ? 'bg-surface font-semibold shadow-sm' : 'text-muted'"
              :aria-pressed="s === scope"
              @click="scope = s"
            >
              {{ SCOPE_LABEL[s] }}
              <span
                v-if="s === 'mine' && mineCount > 0"
                class="ml-1 rounded-full bg-accent px-1.5 text-xs text-white"
              >
                {{ mineCount }}
              </span>
            </button>
          </div>

          <select v-model="typeFilter" aria-label="申請類型" class="field w-auto py-1 text-sm">
            <option value="all">所有類型</option>
            <option v-for="type in FORM_TYPES" :key="type" :value="type">{{ formTitle(type) }}</option>
          </select>
        </div>
      </div>

      <!-- 載入中：用骨架畫面佔位，版面不會在資料出現時突然跳動 -->
      <ul v-if="loading" class="grid gap-3 py-2" aria-busy="true">
        <li v-for="n in 3" :key="n" class="grid animate-pulse gap-2 border-b pb-3">
          <span class="h-4 w-2/3 rounded bg-bg" />
          <span class="h-3 w-1/3 rounded bg-bg" />
        </li>
      </ul>

      <div v-else-if="loadError" class="rounded-lg bg-danger-soft p-4 text-sm text-danger">
        {{ loadError }}
        <button type="button" class="btn ml-2 px-2 py-0.5 text-xs" @click="load">重試</button>
      </div>

      <div v-else-if="visible.length === 0" class="rounded-lg border border-dashed px-4 py-10 text-center">
        <p class="font-medium">{{ empty.title }}</p>
        <p class="mt-1 text-sm text-muted">{{ empty.hint }}</p>
        <button
          v-if="hasFilter && requests.length > 0"
          type="button"
          class="btn mt-4 text-sm"
          @click="clearFilters"
        >
          顯示全部申請單
        </button>
      </div>

      <ul v-else>
        <li v-for="r in visible" :key="r.id">
          <!-- 兩行排版：手機上不會擠成一團；第一行標題與狀態，第二行補充資訊 -->
          <RouterLink :to="`/requests/${r.id}`" class="group grid gap-1 border-b py-3">
            <span class="flex items-start justify-between gap-3">
              <span class="font-medium group-hover:text-accent">{{ r.title }}</span>
              <StatusBadge :status="r.status" />
            </span>
            <span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>{{ formTitle(r.formType) }}</span>
              <span>申請人 {{ r.applicantId }}</span>
              <RiskBadge v-if="r.riskLevel" :level="r.riskLevel" />
              <span v-if="r.status === 'pending_approval' || r.status === 'pending_final_approval'">
                已等待 {{ elapsed(r.updatedAt) }}
              </span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>
