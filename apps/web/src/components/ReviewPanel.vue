<script setup lang="ts">
import { computed } from 'vue'
import type { AiReview, ReviewFinding } from '../types'

const props = defineProps<{
  review: AiReview | null
  reviewing: boolean
  // 串流中即時收到的意見；預審完成後改顯示 review.findings（以後端存下的正式結果為準）
  liveFindings: ReviewFinding[]
  activeCitation: string | null
}>()

// 點引用時通知父元件，由父元件告訴規範面板要高亮哪一段
// 兩個兄弟元件不直接溝通，而是透過共同的父元件傳遞狀態
const emit = defineEmits<{ cite: [id: string] }>()

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
  ok: { label: '符合', class: 'bg-ok-soft' },
}
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
          class="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 rounded-lg px-3 py-2.5"
          :class="KIND[f.kind].class"
        >
          <span class="pt-0.5 text-xs font-semibold">{{ KIND[f.kind].label }}</span>
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
        </li>
      </TransitionGroup>

      <p v-if="!reviewing && review" class="mt-3 text-xs text-muted">
        由 {{ review.reviewer }} 產生，僅供參考，最終由主管決定。
      </p>
    </template>
  </section>
</template>
