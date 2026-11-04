<script setup lang="ts">
import { DEMO_USERS, currentUser, switchUser } from './session'
</script>

<template>
  <header class="flex items-center justify-between border-b bg-surface px-6 py-3">
    <RouterLink to="/" class="font-semibold text-ink no-underline">AI 預審簽核系統</RouterLink>
    <label class="flex items-center gap-2 text-sm">
      <span class="text-muted">目前身分</span>
      <select
        class="field w-auto"
        :value="currentUser.id"
        @change="switchUser(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="u in DEMO_USERS" :key="u.id" :value="u.id">{{ u.name }}</option>
      </select>
    </label>
  </header>
  <main class="mx-auto max-w-6xl p-6">
    <!-- 切換身分時用 key 強制重建頁面，讓資料用新身分重新載入 -->
    <RouterView :key="`${currentUser.id}-${$route.fullPath}`" />
  </main>
</template>
