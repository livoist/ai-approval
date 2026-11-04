<script setup lang="ts">
import { DEMO_USERS, currentUser, switchUser } from './session'
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
  <main class="mx-auto max-w-6xl p-4 sm:p-6">
    <!-- 切換身分時用 key 強制重建頁面，讓資料用新身分重新載入 -->
    <RouterView :key="`${currentUser.id}-${$route.fullPath}`" />
  </main>
</template>
