import type { ActorRole, RequestEvent, RequestStatus } from './types'

// 一條轉換規則：在哪個狀態、收到什麼事件、誰可以觸發、會變成什麼狀態
interface Transition {
  from: RequestStatus
  event: RequestEvent
  to: RequestStatus
  allowedRoles: readonly ActorRole[]
}

// 轉換表（transition table）
// 所有合法的狀態變化都集中寫在這裡，不在表上的一律不允許。
// 好處：規則一眼看得完；前端決定「要顯示哪些按鈕」、後端決定「這個請求可不可以執行」
// 都讀同一張表，兩邊永遠不會不一致。
export const TRANSITIONS: readonly Transition[] = [
  { from: 'draft', event: 'SUBMIT', to: 'reviewing', allowedRoles: ['applicant'] },
  { from: 'reviewing', event: 'AI_REVIEW_DONE', to: 'pending_approval', allowedRoles: ['system'] },
  { from: 'reviewing', event: 'AI_REVIEW_FAILED', to: 'draft', allowedRoles: ['system'] },
  { from: 'pending_approval', event: 'APPROVE', to: 'approved', allowedRoles: ['approver'] },
  { from: 'pending_approval', event: 'REJECT', to: 'rejected', allowedRoles: ['approver'] },
  { from: 'pending_approval', event: 'REQUEST_INFO', to: 'needs_info', allowedRoles: ['approver'] },
  { from: 'needs_info', event: 'RESUBMIT', to: 'reviewing', allowedRoles: ['applicant'] },
  { from: 'pending_approval', event: 'WITHDRAW', to: 'withdrawn', allowedRoles: ['applicant'] },
  { from: 'needs_info', event: 'WITHDRAW', to: 'withdrawn', allowedRoles: ['applicant'] },
]

// 回傳值用「成功或失敗」的物件，而不是丟出例外（throw）
// 呼叫端被 TypeScript 強迫處理失敗的情況，不會忘記
export type TransitionResult =
  | { ok: true; next: RequestStatus }
  | { ok: false; reason: 'invalid_transition' | 'forbidden' }

export function transition(
  current: RequestStatus,
  event: RequestEvent,
  role: ActorRole,
): TransitionResult {
  const rule = TRANSITIONS.find((t) => t.from === current && t.event === event)

  // 這個狀態根本不能接這個事件，例如「已核准」的單又被核准一次
  if (!rule) return { ok: false, reason: 'invalid_transition' }

  // 事件本身合法，但這個角色沒有權限，例如申請人想核准自己的單
  if (!rule.allowedRoles.includes(role)) return { ok: false, reason: 'forbidden' }

  return { ok: true, next: rule.to }
}

// 給前端用：在目前狀態下，這個角色可以做哪些事？（用來決定顯示哪些按鈕）
export function availableEvents(current: RequestStatus, role: ActorRole): RequestEvent[] {
  return TRANSITIONS.filter((t) => t.from === current && t.allowedRoles.includes(role)).map(
    (t) => t.event,
  )
}

// 終點狀態：之後不會再有任何轉換
export function isFinal(status: RequestStatus): boolean {
  return !TRANSITIONS.some((t) => t.from === status)
}
