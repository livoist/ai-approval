<script setup lang="ts">
import { useRouter } from 'vue-router'
import { switchUser } from '../session'

// 試玩導覽：只在公開 demo 顯示
// 第一次來的人不知道要切換身分、也不知道要點範例資料，三步帶他走完整個故事
// 每一步都附一個按鈕，直接切到對的身分、對的頁面，不用自己找

defineEmits<{ close: [] }>()

const router = useRouter()

const STEPS = [
  {
    title: '以申請人送出一張單',
    body: '點「範例資料」裡的「高壓・資料不全」，建立草稿再送出。規則引擎與 AI 會一條一條提出意見，每條都附規範條文，點一下右邊的原文就會高亮。',
    action: '切換成 Alice',
    go: () => to('alice', '/'),
  },
  {
    title: '以主管簽核',
    body: '從「待我簽核」打開剛剛那張單。預審結果與規範原文並排，可以標記 AI 的意見有誤、要求補件或核准。超過金額門檻的單，核准後還要再送林協理。',
    action: '切換成王經理',
    go: () => to('manager', '/'),
  },
  {
    title: '看 AI 怎麼被管理',
    body: '「AI 準確度」找出 AI 最常出錯的規範，把主管的理由採用為審查準則；「AI 調校」用評估集比較套用前後的表現；「規範文件」可以匯入範例 PDF。',
    action: '前往 AI 準確度',
    go: () => to('manager', '/insights'),
  },
]

function to(userId: string, path: string) {
  switchUser(userId)
  router.push(path)
}
</script>

<template>
  <section class="card mb-6 border-accent/30" aria-labelledby="demo-guide-title" data-testid="demo-guide">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 id="demo-guide-title" class="font-semibold">三步看懂這個系統</h2>
        <p class="text-sm text-muted">大約 2 分鐘。右上角可以隨時切換身分。</p>
      </div>
      <button type="button" class="btn shrink-0 px-2 py-1 text-xs" @click="$emit('close')">收起導覽</button>
    </div>
    <ol class="grid gap-3 md:grid-cols-3">
      <li v-for="(step, i) in STEPS" :key="step.title" class="flex flex-col gap-2 rounded-lg bg-bg p-4">
        <p class="flex items-center gap-2 font-medium">
          <span class="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs text-white">{{ i + 1 }}</span>
          {{ step.title }}
        </p>
        <p class="flex-1 text-sm leading-relaxed text-muted">{{ step.body }}</p>
        <button type="button" class="btn self-start text-sm" @click="step.go">{{ step.action }}</button>
      </li>
    </ol>
  </section>
</template>
