<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { PolicyChunk } from '../types'

const props = defineProps<{
  policies: PolicyChunk[]
  activeCitation: string | null
}>()

// 每一段條文的 DOM 元素，用 id 當 key 存起來，之後才找得到要捲到哪裡
const chunkEls = new Map<string, HTMLElement>()
function setChunkEl(id: string, el: unknown) {
  if (el instanceof HTMLElement) chunkEls.set(id, el)
  else chunkEls.delete(id)
}

// 閃一下的動畫：同一個引用連點兩次也要有回饋，所以先移除再加回 class
const flashing = ref<string | null>(null)

watch(
  () => props.activeCitation,
  async (id) => {
    if (!id) return
    await nextTick()
    chunkEls.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flashing.value = null
    requestAnimationFrame(() => (flashing.value = id))
  },
)
</script>

<template>
  <!-- sticky：頁面往下捲時，規範面板固定在畫面上，方便邊看預審邊對照原文 -->
  <!-- 只有寬螢幕並排時才固定：手機上它排在預審結果下面，固定反而會擋住內容
       top-20：避開上方固定的 header，不然捲動時會被它蓋住 -->
  <aside class="card lg:sticky lg:top-20">
    <h3 class="mb-3 font-semibold">{{ policies[0]?.docTitle ?? '規範文件' }}</h3>
    <!-- 寬螢幕：高度扣掉 header 與上下間距，長文件在面板內捲動，不會超出畫面 -->
    <div class="lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
      <p
        v-for="p in policies"
        :key="p.id"
        :ref="(el) => setChunkEl(p.id, el)"
        :data-testid="`policy-${p.id}`"
        class="mb-2 rounded-lg px-3 py-2.5 leading-relaxed transition-colors duration-300"
        :class="{
          'bg-highlight': p.id === activeCitation,
          'animate-flash': p.id === flashing,
        }"
      >
        <span class="mr-1.5 font-semibold">第 {{ p.section }} 條</span>
        {{ p.text }}
      </p>
    </div>
  </aside>
</template>
