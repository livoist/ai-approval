<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from './api'
import { DEMO_USERS, currentUser, switchUser } from './session'
import type { AppMeta } from './types'

// 公開 demo 時顯示提示；拿不到就當作一般環境，不影響其他功能
const meta = ref<AppMeta | null>(null)
onMounted(async () => {
  try {
    meta.value = await api.getMeta()
  } catch {}
})
</script>

<template>
  <!-- sticky top-0：捲動時固定在最上方；z-10 讓它蓋在內容上面；半透明加模糊，捲過去的內容會隱約透出來 -->
  <header
    class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-surface/90 px-4 py-3 backdrop-blur sm:px-6"
  >
    <RouterLink to="/" class="font-semibold text-ink no-underline">AI 預審簽核系統</RouterLink>
    <label class="flex items-center gap-2 text-sm">
      <!-- 手機上空間不夠，隱藏文字；select 本身有 aria-label，螢幕閱讀器一樣讀得到 -->
      <span class="hidden text-muted sm:inline">目前身分</span>
      <select
        aria-label="目前身分"
        class="field w-auto"
        :value="currentUser.id"
        @change="switchUser(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="u in DEMO_USERS" :key="u.id" :value="u.id">{{ u.name }}</option>
      </select>
    </label>
  </header>
  <div
    v-if="meta?.demo"
    class="border-b bg-accent-soft px-4 py-2 text-center text-xs text-accent sm:px-6"
    role="status"
  >
    示範環境：資料會定期重置，可以放心操作。右上角可以切換申請人與主管的身分。
    <template v-if="meta.ai && meta.ai.limit > 0">
      AI 預審今日已使用 {{ meta.ai.used }} / {{ meta.ai.limit }} 次，用完會改用模擬審查員。
    </template>
  </div>

  <main class="mx-auto max-w-6xl p-4 sm:p-6">
    <!-- 切換身分時用 key 強制重建頁面，讓資料用新身分重新載入 -->
    <RouterView :key="`${currentUser.id}-${$route.fullPath}`" />
  </main>
</template>
