<script setup lang="ts">
import { computed } from 'vue'
import type { AiReview, FindingFeedback as Feedback, ReviewFinding } from '../types'
import FindingFeedback from './FindingFeedback.vue'

const props = defineProps<{
  review: AiReview | null
  reviewing: boolean
  // 串流中即時收到的意見；預審完成後改顯示 review.findings（以後端存下的正式結果為準）
  liveFindings: ReviewFinding[]
  activeCitation: string | null
  canGiveFeedback: boolean // 目前使用者能不能評價（主管才可以）
  feedbackBusy: boolean
}>()

// 點引用時通知父元件，由父元件告訴規範面板要高亮哪一段
// 兩個兄弟元件不直接溝通，而是透過共同的父元件傳遞狀態
const emit = defineEmits<{
  cite: [id: string]
  feedback: [index: number, verdict: Feedback['verdict'], note: string]
}>()

const findings = computed(() =>
  props.reviewing ? props.liveFindings : (props.review?.findings ?? []),
)

const RISK = {
  low: { label: '低風險', class: 'text-ok' },
  medium: { label: '中風險', class: 'text-warning' },
  high: { label: '高風險', class: 'text-danger' },
} as const

// 注意：Tailwind 是「掃描原始碼裡出現的完整 class 字串」來產生 CSS
// 所以要寫完整的 'bg-danger-soft'，不能用 `bg-${color}-soft` 這種拼接，否則掃描不到
const KIND: Record<ReviewFinding['kind'], { label: string; class: string }> = {
  missing: { label: '缺漏', class: 'bg-danger-soft' },
  risk: { label: '風險', class: 'bg-warning-soft' },
  notice: { label: '提醒', class: 'bg-accent-soft' },
  ok: { label: '符合', class: 'bg-ok-soft' },
}

// 來源標籤：「規則」是程式判斷、一定正確；「AI」是建議，需要主管判斷
const SOURCE: Record<ReviewFinding['source'], { label: string; class: string }> = {
  rule: { label: '規則', class: 'border-ink/20 text-ink' },
  ai: { label: 'AI', class: 'border-accent/40 text-accent' },
}
// 加入 source 之前存的舊資料沒有這個欄位；當時的意見全部來自 AI 審查員
const sourceOf = (f: ReviewFinding) => SOURCE[f.source ?? 'ai']
</script>

<template>
  <section class="card">
    <h3 class="mb-3 font-semibold">AI 預審</h3>

    <p v-if="!reviewing && !review" class="text-muted">尚未預審。</p>

    <p v-else-if="!reviewing && review?.status === 'failed'" class="text-danger">
      預審失敗：{{ review.error }}。申請單已退回草稿，可以重新送出。
    </p>

    <template v-else>
      <p v-if="reviewing" class="mb-3 flex items-center gap-2 text-muted">
        <span class="size-2 animate-ping rounded-full bg-accent" />
        AI 正在依據規範審查中，已找到 {{ liveFindings.length }} 項……
      </p>
      <p v-else-if="review" class="mb-3">
        <span class="mr-2 font-semibold" :class="RISK[review.riskLevel!].class">
          {{ RISK[review.riskLevel!].label }}
        </span>
        {{ review.summary }}
      </p>

      <!-- TransitionGroup：新的意見加進陣列時，自動套用 enter 動畫 -->
      <TransitionGroup
        tag="ul"
        class="grid gap-2"
        enter-active-class="transition duration-500 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
      >
        <li
          v-for="(f, i) in findings"
          :key="`${i}-${f.message}`"
          data-testid="finding"
          :data-source="f.source ?? 'ai'"
          class="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 rounded-lg px-3 py-2.5"
          :class="KIND[f.kind].class"
        >
          <span class="grid justify-items-start gap-1 pt-0.5">
            <span class="text-xs font-semibold">{{ KIND[f.kind].label }}</span>
            <span class="rounded border px-1 text-[10px] leading-4" :class="sourceOf(f).class">
              {{ sourceOf(f).label }}
            </span>
          </span>
          <span>{{ f.message }}</span>
          <span class="flex flex-wrap gap-1">
            <button
              v-for="c in f.citations"
              :key="c"
              class="btn px-2 py-0.5 text-xs"
              :class="c === activeCitation ? 'btn-primary' : 'text-accent'"
              @click="emit('cite', c)"
            >
              {{ c }}
            </button>
            <span v-if="f.citations.length === 0" class="text-xs text-muted">無引用</span>
          </span>

          <!-- 只有 AI 的意見需要評價：規則是程式判斷，結果是確定的
               預審完成後才能評價；串流中的意見還不是最終結果 -->
          <FindingFeedback
            v-if="(f.source ?? 'ai') === 'ai' && !reviewing && (canGiveFeedback || f.feedback)"
            class="col-span-3 border-t border-black/5 pt-2"
            :feedback="f.feedback"
            :editable="canGiveFeedback"
            :busy="feedbackBusy"
            @submit="(verdict, note) => emit('feedback', i, verdict, note)"
          />
        </li>
      </TransitionGroup>

      <p v-if="!reviewing && review" class="mt-3 text-xs text-muted">
        由 {{ review.reviewer }} 產生，僅供參考，最終由主管決定。
      </p>
    </template>
  </section>
</template>
