<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { isApproverRole } from '@ai-approval/shared'
import DemoGuide from './components/DemoGuide.vue'
import { meta, refreshMeta } from './meta'
import { DEMO_USERS, currentUser, switchUser } from './session'

// 只有簽核者看得到：AI 準確度是給改進 AI 用的，規範文件由簽核者管理
const isApprover = computed(() => isApproverRole(currentUser.value.role))
const APPROVER_LINKS = [
  { to: '/insights', label: 'AI 準確度' },
  { to: '/tuning', label: 'AI 調校' },
  { to: '/policy-docs', label: '規範文件' },
]

// 公開 demo 時顯示提示；拿不到就當作一般環境，不影響其他功能
// 預審完成時，詳情頁會呼叫 refreshMeta()，AI 用量就會即時更新
onMounted(refreshMeta)

// 試玩導覽：公開 demo 的首頁才顯示；收起來之後記在瀏覽器裡，下次不會再跳出來
// localStorage 可能被瀏覽器擋掉（無痕模式），拿不到就當作還沒收起
const GUIDE_KEY = 'demo-guide-closed'
const route = useRoute()
const guideClosed = ref(readGuideClosed())
const showGuide = computed(() => meta.value?.demo && !guideClosed.value && route.path === '/')

function readGuideClosed() {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

function setGuideClosed(closed: boolean) {
  guideClosed.value = closed
  try {
    if (closed) localStorage.setItem(GUIDE_KEY, '1')
    else localStorage.removeItem(GUIDE_KEY)
  } catch {}
}
</script>

<template>
  <!-- sticky top-0：捲動時固定在最上方；z-10 讓它蓋在內容上面；半透明加模糊，捲過去的內容會隱約透出來 -->
  <header
    class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-surface/90 px-4 py-3 backdrop-blur sm:px-6"
  >
    <!-- 手機上放不下時換行，不會擠出畫面 -->
    <nav class="flex flex-wrap items-center gap-x-4 gap-y-1">
      <RouterLink to="/" class="font-semibold text-ink no-underline">AI 預審簽核系統</RouterLink>
      <template v-if="isApprover">
        <RouterLink
          v-for="link in APPROVER_LINKS"
          :key="link.to"
          :to="link.to"
          class="text-sm text-muted no-underline hover:text-accent"
          active-class="!text-accent font-medium"
        >
          {{ link.label }}
        </RouterLink>
      </template>
    </nav>
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
    <button
      v-if="guideClosed"
      type="button"
      class="cursor-pointer underline"
      @click="setGuideClosed(false), $router.push('/')"
    >
      顯示試玩導覽
    </button>
  </div>

  <main class="mx-auto max-w-6xl p-4 sm:p-6">
    <DemoGuide v-if="showGuide" @close="setGuideClosed(true)" />
    <!-- 切換身分時用 key 強制重建頁面，讓資料用新身分重新載入 -->
    <RouterView :key="`${currentUser.id}-${$route.fullPath}`" />
  </main>
</template>
