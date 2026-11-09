import { ref } from 'vue'
import { ApiError } from './api'
import { ERROR_LABEL } from './labels'

// 全站共用的提示（toast）：任何地方出錯都用同一種方式告訴使用者
//
// 什麼錯誤用什麼方式顯示：
// - 欄位填錯：紅字標在欄位旁邊（頁面自己處理），使用者才知道要改哪裡
// - 操作失敗、沒預料到的錯誤：右上角的提示，不擋住畫面，看完會自己消失
// - 頁面整個載入失敗：頁面上顯示錯誤與「重試」，因為沒有內容可以看

export interface Toast {
  id: number
  kind: 'error' | 'success'
  message: string
  detail?: string // 例如錯誤編號：使用者回報時提供，工程師用它在 log 裡找到這一筆
}

export const toasts = ref<Toast[]>([])
let nextId = 1

// 一般提示幾秒後自動消失；帶錯誤編號的會留著，等使用者看完、記下編號再自己關掉
const DURATION = { success: 3000, error: 4000 }

export function dismiss(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

export function notify(kind: Toast['kind'], message: string, detail?: string) {
  // 同樣的訊息已經在畫面上就不要重複疊（例如連按好幾次都失敗）
  if (toasts.value.some((t) => t.kind === kind && t.message === message && t.detail === detail)) return
  const id = nextId++
  toasts.value = [...toasts.value.slice(-3), { id, kind, message, detail }] // 最多同時 4 則
  if (!detail) setTimeout(() => dismiss(id), DURATION[kind])
}

// 欄位驗證類的錯誤：頁面會把它標在欄位旁邊
const VALIDATION_REASONS = new Set(['invalid_fields', 'invalid_doc', 'note_required', 'invalid_guideline'])
export const isValidationError = (e: unknown) => e instanceof ApiError && VALIDATION_REASONS.has(e.reason)

// 任何錯誤 → 給使用者看的一句話
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    return ERROR_LABEL[e.reason] ?? `操作沒有完成（狀態碼 ${e.status}），請稍後再試`
  }
  // 不是後端回傳的錯誤，通常是前端程式的問題：細節記在 console，給使用者的是可以照著做的指示
  return '畫面發生錯誤，請重新整理頁面後再試'
}

export function notifyError(e: unknown) {
  const requestId = e instanceof ApiError ? e.requestId : undefined
  notify('error', errorMessage(e), requestId ? `錯誤編號 ${requestId}` : undefined)
}

// 整頁載入失敗時，顯示在頁面上的訊息（不用提示，因為頁面沒有內容可以看）
export function loadErrorMessage(what: string, e: unknown): string {
  if (e instanceof ApiError && e.reason === 'network') return `無法載入${what}：無法連線到伺服器，請確認網路連線，或稍後再試。`
  const id = e instanceof ApiError && e.requestId ? `（錯誤編號 ${e.requestId}）` : ''
  return `無法載入${what}，請稍後再試。${id}`
}
