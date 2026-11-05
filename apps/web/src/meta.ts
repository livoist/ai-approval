import { ref } from 'vue'
import { api } from './api'
import type { AppMeta } from './types'

// 系統資訊（是否為示範環境、AI 今日用量）放在獨立的模組裡
// 這樣 header 的橫幅負責「顯示」，預審完成的頁面負責「通知它更新」，兩邊不用互相知道對方
export const meta = ref<AppMeta | null>(null)

// 拿不到就維持原本的值：橫幅只是輔助資訊，不能因為它讓頁面出錯
export async function refreshMeta() {
  try {
    meta.value = await api.getMeta()
  } catch {}
}
