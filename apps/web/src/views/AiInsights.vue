<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { format } from 'echarts/core'
import { getFormKind, isApproverRole, isFormType } from '@ai-approval/shared'
import { api } from '../api'
import EChart from '../components/EChart.vue'
import { currentUser } from '../session'
import { formatDateTime } from '../time'
import type { AiStats, VerdictCounts } from '../types'

// AI 準確度儀表板：主管每一次「正確 / 有誤」的評價，累積起來回答三個問題
// 1. AI 整體可不可靠？（認同率、評價覆蓋率）
// 2. 最近有沒有變好或變差？（每日趨勢）
// 3. 哪裡最常出錯，下一步該改哪裡？（依條文排行、主管寫的理由）

const stats = ref<AiStats | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const isApprover = computed(() => isApproverRole(currentUser.value.role))

async function load() {
  loading.value = true
  error.value = null
  try {
    stats.value = await api.getAiStats()
  } catch {
    error.value = '無法載入統計資料，請確認後端伺服器是否啟動。'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (isApprover.value) load()
  else loading.value = false
})

// ===== 數字 =====
const unrated = (c: VerdictCounts) => c.total - c.correct - c.incorrect
const rated = (c: VerdictCounts) => c.correct + c.incorrect
// 沒有資料時顯示「—」而不是 0% 或 NaN%：0% 會被誤讀成「AI 全錯」
const percent = (part: number, whole: number) => (whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`)

const kpis = computed(() => {
  if (!stats.value) return []
  const ai = stats.value.totals.aiFindings
  return [
    { label: 'AI 意見', value: String(ai.total), hint: `${stats.value.totals.reviews} 次預審` },
    { label: '主管已評價', value: percent(rated(ai), ai.total), hint: `${rated(ai)} / ${ai.total} 條` },
    // 認同率只算「有評價的」：沒評價不代表正確，混進來會讓數字虛高
    { label: '主管認同率', value: percent(ai.correct, rated(ai)), hint: `${ai.correct} / ${rated(ai)} 條評價為正確` },
    { label: '被標記有誤', value: String(ai.incorrect), hint: '每一筆都附主管寫的理由' },
  ]
})

// 最常被標記有誤的條文：就是下一步要改 prompt 的地方
const worst = computed(() => stats.value?.byPolicy.find((p) => p.incorrect > 0) ?? null)

// ===== 圖表 =====
// 顏色依「意義」固定：有誤永遠是橘、認同永遠是藍、未評價是灰，兩張圖一致
// 不用紅綠：紅綠色盲的人分不出來；藍橘在各種色覺下都分得開
const COLOR = { incorrect: '#eb6834', correct: '#2a78d6', unrated: '#d0d5dd' }
const INK = { muted: '#667085', grid: '#eef0f3', surface: '#ffffff' }

// 堆疊順序：有誤貼著基準線，最容易比較高低；未評價放最上面
const SERIES = [
  { key: 'incorrect', name: '有誤', value: (c: VerdictCounts) => c.incorrect },
  { key: 'correct', name: '認同', value: (c: VerdictCounts) => c.correct },
  { key: 'unrated', name: '未評價', value: unrated },
] as const

// 每一段之間留 2px 白色間隔，相鄰的顏色不會黏在一起；只有最外側那段是圓角
function stackSeries(rows: VerdictCounts[], horizontal: boolean) {
  return SERIES.map((s, i) => ({
    type: 'bar' as const,
    name: s.name,
    stack: 'verdict',
    barMaxWidth: horizontal ? 18 : 28,
    data: rows.map(s.value),
    itemStyle: {
      color: COLOR[s.key],
      borderColor: INK.surface,
      borderWidth: 2,
      borderRadius: i === SERIES.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0,
    },
    // 滑過時不要讓其他段變淡：tooltip 列的是同一天的三段，三段都要看得清楚
    emphasis: { disabled: true },
  }))
}

const baseOption = {
  textStyle: { fontFamily: 'inherit', color: INK.muted },
  legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: INK.muted } },
  tooltip: {
    trigger: 'axis' as const,
    // 滑過時整欄打上很淡的藍色底，不能用灰色：會跟「未評價」的灰色混在一起
    axisPointer: { type: 'shadow' as const, shadowStyle: { color: 'rgba(37, 99, 235, 0.06)' } },
    borderColor: '#e2e5ea',
    textStyle: { color: '#1d2330', fontSize: 12 },
  },
}

// tooltip 是 HTML 字串：內容一律跳脫，條文或理由裡有 < > 也不會被當成標籤
const esc = (s: string) => format.encodeHTML(s)
type TooltipParam = { seriesName: string; value: number; color: string; dataIndex: number }
const tooltipRows = (params: TooltipParam[]) =>
  params
    .map(
      (p) =>
        `<div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:2px;background:${p.color}"></span>` +
        `<b>${p.value}</b><span style="color:${INK.muted}">${esc(p.seriesName)}</span></div>`,
    )
    .join('')

const dailyOption = computed(() => {
  const daily = stats.value?.daily ?? []
  return {
    ...baseOption,
    grid: { top: 36, left: 8, right: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: daily.map((d) => d.date.slice(5).replace('-', '/')),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e2e5ea' } },
    },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: INK.grid } } },
    tooltip: {
      ...baseOption.tooltip,
      formatter: (params: TooltipParam[]) => {
        const day = daily[params[0]!.dataIndex]!
        return `<div style="margin-bottom:4px">${esc(day.date)}・AI 意見 ${day.total} 條</div>${tooltipRows(params)}`
      },
    },
    series: stackSeries(daily, false),
  }
})

const policyOption = computed(() => {
  // 橫條圖由下往上畫，反轉之後排行第一的才會在最上面
  const rows = [...(stats.value?.byPolicy ?? [])].reverse()
  return {
    ...baseOption,
    grid: { top: 36, left: 8, right: 16, bottom: 8, containLabel: true },
    xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: INK.grid } } },
    yAxis: {
      type: 'category',
      data: rows.map((p) => p.policyId ?? '無引用'),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { color: '#1d2330', fontFamily: 'ui-monospace, monospace' },
    },
    tooltip: {
      ...baseOption.tooltip,
      formatter: (params: TooltipParam[]) => {
        const p = rows[params[0]!.dataIndex]!
        return (
          `<div style="max-width:260px;white-space:normal;margin-bottom:4px"><b>${esc(p.policyId ?? '無引用')}</b> ` +
          `<span style="color:${INK.muted}">${esc(p.text)}</span></div>${tooltipRows(params)}`
        )
      },
    },
    series: stackSeries(rows, true),
  }
})

// 每條條文一列，條文越多圖越高，不會擠在一起
const policyHeight = computed(() => 60 + (stats.value?.byPolicy.length ?? 0) * 36)

const formTitle = (type: string) => (isFormType(type) ? getFormKind(type).def.title : type)
const REVIEWER_LABEL: Record<string, string> = { mock: '模擬審查員' }
</script>

<template>
  <div class="grid gap-6">
    <div>
      <h1 class="text-xl font-semibold">AI 準確度</h1>
      <p class="mt-1 text-sm text-muted">
        主管對每一條 AI 意見的「正確 / 有誤」評價，累積起來就知道 AI 哪裡可靠、哪裡需要調整。規則引擎的意見是程式判斷的，不列入評價。
      </p>
    </div>

    <div v-if="!isApprover" class="card text-center">
      <p class="font-medium">只有簽核者可以查看</p>
      <p class="mt-1 text-sm text-muted">切換成主管或廠長的身分再試一次。</p>
    </div>

    <!-- 載入中：骨架佔位，跟資料出現後的版面一樣大 -->
    <div v-else-if="loading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
      <div v-for="n in 4" :key="n" class="card h-24 animate-pulse" />
    </div>

    <div v-else-if="error" class="rounded-lg bg-danger-soft p-4 text-sm text-danger">
      {{ error }}
      <button type="button" class="btn ml-2 px-2 py-0.5 text-xs" @click="load">重試</button>
    </div>

    <template v-else-if="stats">
      <div v-if="stats.totals.aiFindings.total === 0" class="card py-10 text-center">
        <p class="font-medium">還沒有 AI 意見</p>
        <p class="mt-1 text-sm text-muted">申請單送出、AI 提出意見之後，主管在簽核頁評價，這裡就會開始累積數字。</p>
      </div>

      <template v-else>
        <!-- 重點數字：不用看圖就知道整體狀況 -->
        <dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div v-for="k in kpis" :key="k.label" class="card" :data-testid="`kpi-${k.label}`">
            <dt class="text-sm text-muted">{{ k.label }}</dt>
            <dd class="mt-1 text-3xl font-semibold tabular-nums">{{ k.value }}</dd>
            <dd class="mt-1 text-xs text-muted">{{ k.hint }}</dd>
          </div>
        </dl>

        <!-- 結論先講：最該處理的是哪一條 -->
        <div v-if="worst" class="rounded-xl border border-warning/30 bg-warning-soft px-5 py-4" data-testid="worst-policy">
          <p class="text-sm font-medium text-warning">最常被標記有誤</p>
          <p class="mt-1">
            <span class="font-mono font-semibold">{{ worst.policyId ?? '無引用' }}</span>
            被主管否定 {{ worst.incorrect }} 次（共 {{ worst.total }} 條意見）
          </p>
          <p class="mt-1 text-sm text-muted">{{ worst.text }}</p>
          <p class="mt-2 text-sm">建議先看下方主管寫的理由，再調整 prompt 中對這條規範的說明。</p>
        </div>

        <div class="grid items-start gap-6 lg:grid-cols-2">
          <section class="card">
            <h2 class="font-semibold">每日 AI 意見與評價</h2>
            <p class="mb-3 text-xs text-muted">近 14 天，依 AI 提出意見的日期</p>
            <EChart :option="dailyOption" :height="260" label="近 14 天每日 AI 意見數，依評價分為有誤、認同、未評價" />
            <!-- 圖表的替代方案：看不到顏色、或想要確切數字的人用表格 -->
            <details class="mt-3 text-sm">
              <summary class="cursor-pointer text-muted">以表格檢視</summary>
              <table class="mt-2 w-full text-right tabular-nums">
                <thead class="text-xs text-muted">
                  <tr><th class="text-left font-normal">日期</th><th class="font-normal">有誤</th><th class="font-normal">認同</th><th class="font-normal">未評價</th></tr>
                </thead>
                <tbody>
                  <tr v-for="d in stats.daily" :key="d.date" class="border-t">
                    <td class="py-1 text-left">{{ d.date }}</td>
                    <td>{{ d.incorrect }}</td>
                    <td>{{ d.correct }}</td>
                    <td>{{ unrated(d) }}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </section>

          <section class="card">
            <h2 class="font-semibold">依引用條文</h2>
            <p class="mb-3 text-xs text-muted">AI 引用這條規範提出的意見，主管怎麼評價；滑過長條看條文內容</p>
            <EChart :option="policyOption" :height="policyHeight" label="各條文的 AI 意見數，依評價分為有誤、認同、未評價" />
            <details class="mt-3 text-sm">
              <summary class="cursor-pointer text-muted">以表格檢視</summary>
              <table class="mt-2 w-full text-right tabular-nums">
                <thead class="text-xs text-muted">
                  <tr><th class="text-left font-normal">條文</th><th class="font-normal">有誤</th><th class="font-normal">認同</th><th class="font-normal">未評價</th></tr>
                </thead>
                <tbody>
                  <tr v-for="p in stats.byPolicy" :key="p.policyId ?? 'none'" class="border-t">
                    <td class="py-1 text-left">
                      <span class="font-mono">{{ p.policyId ?? '無引用' }}</span>
                      <span class="ml-2 text-xs text-muted">{{ p.text }}</span>
                    </td>
                    <td>{{ p.incorrect }}</td>
                    <td>{{ p.correct }}</td>
                    <td>{{ unrated(p) }}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </section>
        </div>

        <section class="card">
          <h2 class="mb-3 font-semibold">主管標記有誤的意見</h2>
          <p v-if="stats.recentIncorrect.length === 0" class="text-sm text-muted">目前沒有被標記有誤的意見。</p>
          <ul v-else class="grid gap-3">
            <li v-for="r in stats.recentIncorrect" :key="r.requestId + r.at" class="grid gap-1 border-b pb-3 text-sm" data-testid="incorrect-item">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <RouterLink :to="`/requests/${r.requestId}`" class="font-medium text-ink hover:text-accent">{{ r.title }}</RouterLink>
                <span>{{ formTitle(r.formType) }}</span>
                <span v-for="c in r.citations" :key="c" class="font-mono">{{ c }}</span>
                <span>{{ formatDateTime(r.at) }}</span>
              </div>
              <p><span class="text-muted">AI：</span>{{ r.message }}</p>
              <p><span class="text-muted">{{ r.actorId }}：</span>{{ r.note }}</p>
            </li>
          </ul>
        </section>

        <!-- 數量少的比較用表格就好，不是每個數字都需要畫成圖 -->
        <div class="grid items-start gap-6 lg:grid-cols-2">
          <section class="card">
            <h2 class="mb-3 font-semibold">規則與 AI 的分工</h2>
            <table class="w-full text-right text-sm tabular-nums">
              <thead class="text-xs text-muted">
                <tr><th class="text-left font-normal">申請類型</th><th class="font-normal">規則意見</th><th class="font-normal">AI 意見</th><th class="font-normal">認同率</th></tr>
              </thead>
              <tbody>
                <tr v-for="f in stats.byFormType" :key="f.formType" class="border-t">
                  <td class="py-2 text-left">{{ f.title }}</td>
                  <td>{{ f.ruleFindings }}</td>
                  <td>{{ f.aiFindings.total }}</td>
                  <td>{{ percent(f.aiFindings.correct, rated(f.aiFindings)) }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="card">
            <h2 class="mb-3 font-semibold">依審查員</h2>
            <table class="w-full text-right text-sm tabular-nums">
              <thead class="text-xs text-muted">
                <tr><th class="text-left font-normal">審查員</th><th class="font-normal">AI 意見</th><th class="font-normal">已評價</th><th class="font-normal">認同率</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in stats.byReviewer" :key="r.reviewer" class="border-t">
                  <td class="py-2 text-left">{{ REVIEWER_LABEL[r.reviewer] ?? r.reviewer }}</td>
                  <td>{{ r.total }}</td>
                  <td>{{ rated(r) }}</td>
                  <td>{{ percent(r.correct, rated(r)) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="mt-2 text-xs text-muted">換模型或改 prompt 之後，用這張表比較前後的認同率。</p>
          </section>
        </div>
      </template>
    </template>
  </div>
</template>
