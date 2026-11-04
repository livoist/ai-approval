<script setup lang="ts">
type RiskLevel = 'low' | 'medium' | 'high'

defineProps<{ level: RiskLevel }>()

const STYLE: Record<RiskLevel, { label: string; class: string }> = {
  high: { label: '高風險', class: 'text-danger' },
  medium: { label: '中風險', class: 'text-warning' },
  low: { label: '低風險', class: 'text-ok' },
}
</script>

<template>
  <!-- 圓點 + 文字：只靠顏色區分的話，色盲的使用者會看不出差別 -->
  <span class="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap" :class="STYLE[level].class">
    <span class="size-2 rounded-full bg-current" />
    {{ STYLE[level].label }}
  </span>
</template>
