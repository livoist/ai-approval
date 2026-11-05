<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { PolicyChunk } from '../types'

const props = defineProps<{
  policies: PolicyChunk[]
  activeCitation: string | null
  // 這次預審交給 AI 的條文（檢索的結果）；還沒預審過是 null
  retrieved?: string[] | null
}>()

// 一種申請單可能依據好幾份文件（內建的 + 主管匯入的），依文件分組顯示
const docs = computed(() => {
  const groups = new Map<string, { title: string; chunks: PolicyChunk[] }>()
  for (const p of props.policies) {
    let g = groups.get(p.docId)
    if (!g) groups.set(p.docId, (g = { title: p.docTitle, chunks: [] }))
    g.chunks.push(p)
  }
  return [...groups.entries()].map(([id, g]) => ({ id, ...g }))
})

// 只有真的「挑過」才標示：全部條文都給了 AI 的話，每條都標「AI 參考」只是雜訊
const retrievedSet = computed(() => {
  const ids = props.retrieved
  return ids && ids.length < props.policies.length ? new Set(ids) : null
})

// 內建規範用「第 4.2 條」；PDF 沒有條號、依段落切的用「p1」，就照原樣顯示
const sectionLabel = (section: string) => (/^\d/.test(section) ? `第 ${section} 條` : section)

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
    <p v-if="retrievedSet" class="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent" data-testid="retrieval-note">
      這次預審依申請內容挑出 {{ retrievedSet.size }} / {{ policies.length }} 條規範交給 AI，標示「AI 參考」的就是這些
    </p>
    <!-- 寬螢幕：高度扣掉 header 與上下間距，長文件在面板內捲動，不會超出畫面 -->
    <div class="lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
      <section v-for="doc in docs" :key="doc.id" class="mb-4 last:mb-0">
        <h3 class="mb-2 font-semibold">{{ doc.title }}</h3>
        <p
          v-for="p in doc.chunks"
          :key="p.id"
          :ref="(el) => setChunkEl(p.id, el)"
          :data-testid="`policy-${p.id}`"
          :data-retrieved="retrievedSet?.has(p.id) ? 'true' : undefined"
          class="mb-2 rounded-lg px-3 py-2.5 leading-relaxed transition-colors duration-300"
          :class="{
            'bg-highlight': p.id === activeCitation,
            'animate-flash': p.id === flashing,
            'opacity-60': retrievedSet && !retrievedSet.has(p.id) && p.id !== activeCitation,
          }"
        >
          <span class="mr-1.5 font-semibold">{{ sectionLabel(p.section) }}</span>
          <span
            v-if="retrievedSet?.has(p.id)"
            class="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent"
          >
            AI 參考
          </span>
          {{ p.text }}
        </p>
      </section>
    </div>
  </aside>
</template>
