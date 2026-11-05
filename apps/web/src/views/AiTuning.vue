<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getFormKind, isApproverRole } from '@ai-approval/shared'
import { ApiError, api } from '../api'
import { ERROR_LABEL } from '../labels'
import { currentUser } from '../session'
import { formatDateTime } from '../time'
import type { EvalCaseResult, EvalRun, EvalRunSummary, EvalSummary, Guideline } from '../types'

// AI 調校：把主管的回饋接回 AI，並用評估集驗證有沒有變好
//
// 閉環：主管標記 AI 有誤 → 採用為審查準則 → 之後的預審把準則交給 AI → 評估集比較套用前後
// 只靠「感覺 AI 變好了」不夠，要有一組固定的題目，每次都比同一組，數字才能說服人

const isApprover = computed(() => isApproverRole(currentUser.value.role))

const guidelines = ref<Guideline[]>([])
const runs = ref<EvalRunSummary[]>([])
const selected = ref<EvalRun | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

const active = computed(() => guidelines.value.filter((g) => !g.retiredAt))
const retired = computed(() => guidelines.value.filter((g) => g.retiredAt))

async function load() {
  loading.value = true
  loadError.value = null
  try {
    ;[guidelines.value, runs.value] = await Promise.all([api.listGuidelines(), api.listEvalRuns()])
    // 預設打開最近一次評估
    if (runs.value[0] && selected.value?.id !== runs.value[0].id) selected.value = await api.getEvalRun(runs.value[0].id)
  } catch {
    loadError.value = '無法載入資料，請確認後端伺服器是否啟動。'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (isApprover.value) load()
  else loading.value = false
})

// ===== 準則 =====
const retiring = ref<string | null>(null)
const error = ref<string | null>(null)

async function retire(g: Guideline) {
  retiring.value = g.id
  error.value = null
  try {
    await api.retireGuideline(g.id)
    guidelines.value = await api.listGuidelines()
  } catch (e) {
    error.value = e instanceof ApiError ? (ERROR_LABEL[e.reason] ?? e.message) : String(e)
  } finally {
    retiring.value = null
  }
}

// ===== 評估 =====
const running = ref(false)

async function startEval() {
  running.value = true
  error.value = null
  try {
    selected.value = await api.startEval()
    runs.value = await api.listEvalRuns()
  } catch (e) {
    error.value = e instanceof ApiError ? (ERROR_LABEL[e.reason] ?? e.message) : String(e)
  } finally {
    running.value = false
  }
}

async function openRun(id: string) {
  selected.value = await api.getEvalRun(id)
}

// 比較表的三列：通過的案例、該抓的抓到幾條、誤報幾條
// better：數字變大是好事還是壞事（誤報變多是壞事）
const METRICS = [
  { key: 'passed', label: '通過的案例', of: (s: EvalSummary) => `${s.passed} / ${s.total}`, value: (s: EvalSummary) => s.passed, better: 'up' },
  { key: 'caught', label: '該抓的抓到', of: (s: EvalSummary) => `${s.caught} / ${s.expected}`, value: (s: EvalSummary) => s.caught, better: 'up' },
  { key: 'falseAlarms', label: '誤報', of: (s: EvalSummary) => `${s.falseAlarms} 條`, value: (s: EvalSummary) => s.falseAlarms, better: 'down' },
] as const

function delta(m: (typeof METRICS)[number], run: EvalRun) {
  const d = m.value(run.report.withGuidelines.summary) - m.value(run.report.baseline.summary)
  if (d === 0) return { text: '持平', tone: 'text-muted' }
  const good = m.better === 'up' ? d > 0 : d < 0
  return { text: `${d > 0 ? '+' : ''}${d}`, tone: good ? 'text-ok' : 'text-danger' }
}

const caseRows = computed(() => {
  const run = selected.value
  if (!run) return []
  const byId = (list: EvalCaseResult[]) => new Map(list.map((r) => [r.caseId, r]))
  const base = byId(run.report.baseline.results)
  const withG = byId(run.report.withGuidelines.results)
  return run.report.cases.map((c) => ({ ...c, baseline: base.get(c.id)!, withGuidelines: withG.get(c.id)! }))
})

// 沒通過的原因寫成一句話，滑過或在手機上直接看得到
function reason(r: EvalCaseResult) {
  if (r.error) return `審查出錯：${r.error}`
  const parts = [
    ...(r.missed.length ? [`漏抓 ${r.missed.join('、')}`] : []),
    ...(r.falseAlarms.length ? [`誤報 ${r.falseAlarms.join('、')}`] : []),
  ]
  return parts.join('，')
}

const expectation = (c: { shouldFlag: string[]; shouldNotFlag: string[] }) =>
  c.shouldFlag.length ? `應提出 ${c.shouldFlag.join('、')}` : `不應提出 ${c.shouldNotFlag.join('、')}`

const usedMock = computed(() => {
  const run = selected.value
  if (!run) return false
  return [...run.report.baseline.results, ...run.report.withGuidelines.results].some((r) => r.reviewer.startsWith('mock'))
})

const formTitle = (type: Parameters<typeof getFormKind>[0]) => getFormKind(type).def.title
</script>

<template>
  <div class="grid gap-6">
    <div>
      <h1 class="text-xl font-semibold">AI 調校</h1>
      <p class="mt-1 text-sm text-muted">把主管的回饋接回 AI，再用一組固定的題目驗證有沒有變好。</p>
    </div>

    <!-- 閉環的四步：讓第一次看的人知道這頁在整個流程的哪裡 -->
    <ol class="grid gap-2 text-sm sm:grid-cols-4">
      <li
        v-for="(step, i) in [
          ['主管標記有誤', '在簽核頁評價 AI 的意見，寫下理由'],
          ['採用為審查準則', '在「AI 準確度」挑出值得採用的理由'],
          ['預審時交給 AI', '預審到相關規範時，AI 會一併讀到準則'],
          ['評估集驗證', '同一組題目，比較套用準則前後的表現'],
        ]"
        :key="i"
        class="rounded-lg border bg-surface px-3 py-2"
      >
        <p class="font-medium"><span class="mr-1 text-accent">{{ i + 1 }}</span>{{ step[0] }}</p>
        <p class="text-xs text-muted">{{ step[1] }}</p>
      </li>
    </ol>

    <div v-if="!isApprover" class="card text-center">
      <p class="font-medium">只有簽核者可以查看</p>
      <p class="mt-1 text-sm text-muted">切換成主管或廠長的身分再試一次。</p>
    </div>

    <div v-else-if="loading" class="grid animate-pulse gap-4" aria-busy="true">
      <div class="card h-32" />
      <div class="card h-64" />
    </div>

    <div v-else-if="loadError" class="rounded-lg bg-danger-soft p-4 text-sm text-danger">
      {{ loadError }}
      <button type="button" class="btn ml-2 px-2 py-0.5 text-xs" @click="load">重試</button>
    </div>

    <template v-else>
      <p v-if="error" class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

      <!-- 審查準則 -->
      <section class="card">
        <h2 class="font-semibold">審查準則</h2>
        <p class="mb-3 text-xs text-muted">預審時，只有跟這次交給 AI 的條文相關的準則才會放進 prompt。停用後保留紀錄，過去的預審查得到當時套用了什麼。</p>

        <div v-if="active.length === 0" class="rounded-lg border border-dashed px-4 py-6 text-center text-sm">
          <p class="font-medium">還沒有審查準則</p>
          <p class="mt-1 text-muted">
            到 <RouterLink to="/insights" class="text-accent underline">AI 準確度</RouterLink>，從主管標記有誤的意見裡挑一筆「採用為審查準則」。
          </p>
        </div>
        <ul v-else class="grid gap-2">
          <li
            v-for="g in active"
            :key="g.id"
            class="flex items-start justify-between gap-3 rounded-lg bg-bg px-3 py-2.5"
            data-testid="guideline"
          >
            <div class="grid gap-0.5 text-sm">
              <p><span class="mr-2 font-mono font-semibold">{{ g.policyId }}</span>{{ g.text }}</p>
              <p class="text-xs text-muted">{{ g.createdBy }} 於 {{ formatDateTime(g.createdAt) }} 採用</p>
            </div>
            <button type="button" class="btn shrink-0 px-2 py-0.5 text-xs" :disabled="retiring === g.id" @click="retire(g)">
              停用
            </button>
          </li>
        </ul>
        <details v-if="retired.length" class="mt-3 text-sm">
          <summary class="cursor-pointer text-muted">已停用 {{ retired.length }} 條</summary>
          <ul class="mt-2 grid gap-1 text-xs text-muted">
            <li v-for="g in retired" :key="g.id">
              <span class="font-mono">{{ g.policyId }}</span> {{ g.text }}（{{ g.retiredBy }} 於 {{ formatDateTime(g.retiredAt!) }} 停用）
            </li>
          </ul>
        </details>
      </section>

      <!-- 評估集 -->
      <section class="card">
        <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold">評估集</h2>
            <p class="text-xs text-muted">10 個答案已知的案例，各跑「不套用準則」與「套用準則」一次。用 Claude 時約需一分鐘，會計入 AI 每日用量。</p>
          </div>
          <button type="button" class="btn btn-primary" :disabled="running" @click="startEval">
            {{ running ? '評估中…' : '執行評估' }}
          </button>
        </div>

        <div v-if="!selected" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted">
          還沒有評估紀錄，按「執行評估」跑第一次。
        </div>

        <template v-else>
          <p class="mb-3 text-xs text-muted">
            {{ formatDateTime(selected.createdAt) }} · {{ selected.createdBy }} 執行 · 審查員 {{ selected.reviewer }} ·
            套用 {{ selected.report.guidelines.length }} 條準則
          </p>
          <p v-if="usedMock" class="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            這次由模擬審查員完成。模擬審查員看不懂準則的文字，只會在有準則時放寬那條規範的判斷標準，用來展示整個流程；實際效果請設定 Claude 再評估。
          </p>

          <!-- 前後比較 -->
          <table class="mb-5 w-full text-right text-sm tabular-nums">
            <thead class="text-xs text-muted">
              <tr>
                <th class="text-left font-normal">指標</th>
                <th class="font-normal">不套用準則</th>
                <th class="font-normal">套用準則</th>
                <th class="font-normal">變化</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in METRICS" :key="m.key" class="border-t" :data-testid="`metric-${m.key}`">
                <td class="py-2 text-left">{{ m.label }}</td>
                <td data-variant="baseline">{{ m.of(selected.report.baseline.summary) }}</td>
                <td data-variant="with" class="font-semibold">{{ m.of(selected.report.withGuidelines.summary) }}</td>
                <td :class="delta(m, selected).tone">{{ delta(m, selected).text }}</td>
              </tr>
            </tbody>
          </table>

          <!-- 每一題 -->
          <h3 class="mb-2 text-sm font-medium">各案例結果</h3>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[36rem] text-sm">
              <thead class="text-left text-xs text-muted">
                <tr>
                  <th class="py-1 font-normal">案例</th>
                  <th class="font-normal">期望</th>
                  <th class="w-28 font-normal">不套用準則</th>
                  <th class="w-28 font-normal">套用準則</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in caseRows" :key="c.id" class="border-t align-top" data-testid="eval-case">
                  <td class="py-2 pr-3">
                    <p>{{ c.name }}</p>
                    <p class="text-xs text-muted">{{ formTitle(c.formType) }} · {{ c.why }}</p>
                  </td>
                  <td class="py-2 pr-3 font-mono text-xs">{{ expectation(c) }}</td>
                  <td v-for="r in [c.baseline, c.withGuidelines]" :key="r === c.baseline ? 'b' : 'w'" class="py-2 text-xs">
                    <span v-if="r.passed" class="font-medium text-ok">✓ 通過</span>
                    <span v-else class="font-medium text-danger">✗ {{ reason(r) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- 歷次評估 -->
        <details v-if="runs.length > 1" class="mt-4 text-sm">
          <summary class="cursor-pointer text-muted">歷次評估（{{ runs.length }} 次）</summary>
          <ul class="mt-2 grid gap-1">
            <li v-for="r in runs" :key="r.id">
              <button
                type="button"
                class="w-full cursor-pointer rounded px-2 py-1 text-left text-xs hover:bg-bg"
                :class="{ 'bg-bg font-medium': r.id === selected?.id }"
                @click="openRun(r.id)"
              >
                {{ formatDateTime(r.createdAt) }} · {{ r.reviewer }} · {{ r.guidelineIds.length }} 條準則 · 通過
                {{ r.baseline.passed }} → {{ r.withGuidelines.passed }} / {{ r.withGuidelines.total }}
              </button>
            </li>
          </ul>
        </details>
      </section>
    </template>
  </div>
</template>
