import type { ActorRole, RequestEvent, RequestStatus } from './types'

// 轉換時可以參考的「申請單內容」
// 同一個狀態收到同一個事件，結果可能不一樣：主管核准之後，要直接結案還是再送廠長，取決於金額
// 這份資訊由規則引擎算出來（見 forms/index.ts 的 needsPlantManager），狀態機只負責讀
export interface TransitionContext {
  needsPlantManager: boolean
}

const NO_CONTEXT: TransitionContext = { needsPlantManager: false }

// 守衛條件（guard）：一條轉換只有在條件成立時才會被選中
// 寫成有名字的函式而不是隨手寫在表裡，表格讀起來才像一句話：「需要廠長時，主管核准會送到廠長」
const GUARDS = {
  needsPlantManager: (ctx: TransitionContext) => ctx.needsPlantManager,
  noPlantManager: (ctx: TransitionContext) => !ctx.needsPlantManager,
}

// 一條轉換規則：在哪個狀態、收到什麼事件、誰可以觸發、會變成什麼狀態，以及（選填）什麼條件下才成立
interface Transition {
  from: RequestStatus
  event: RequestEvent
  to: RequestStatus
  allowedRoles: readonly ActorRole[]
  when?: keyof typeof GUARDS
}

// 轉換表（transition table）
// 所有合法的狀態變化都集中寫在這裡，不在表上的一律不允許。
// 好處：規則一眼看得完；前端決定「要顯示哪些按鈕」、後端決定「這個請求可不可以執行」
// 都讀同一張表，兩邊永遠不會不一致。
export const TRANSITIONS: readonly Transition[] = [
  { from: 'draft', event: 'SUBMIT', to: 'reviewing', allowedRoles: ['applicant'] },
  { from: 'reviewing', event: 'AI_REVIEW_DONE', to: 'pending_approval', allowedRoles: ['system'] },
  { from: 'reviewing', event: 'AI_REVIEW_FAILED', to: 'draft', allowedRoles: ['system'] },

  // 第一層：主管。核准之後要不要再送廠長，由守衛條件決定
  { from: 'pending_approval', event: 'APPROVE', to: 'pending_final_approval', allowedRoles: ['approver'], when: 'needsPlantManager' },
  { from: 'pending_approval', event: 'APPROVE', to: 'approved', allowedRoles: ['approver'], when: 'noPlantManager' },
  { from: 'pending_approval', event: 'REJECT', to: 'rejected', allowedRoles: ['approver'] },
  { from: 'pending_approval', event: 'REQUEST_INFO', to: 'needs_info', allowedRoles: ['approver'] },

  // 第二層：廠長。退回或要求補件的話，補件後要從頭再走一次（重新預審、主管再簽）
  { from: 'pending_final_approval', event: 'APPROVE', to: 'approved', allowedRoles: ['plant_manager'] },
  { from: 'pending_final_approval', event: 'REJECT', to: 'rejected', allowedRoles: ['plant_manager'] },
  { from: 'pending_final_approval', event: 'REQUEST_INFO', to: 'needs_info', allowedRoles: ['plant_manager'] },

  { from: 'needs_info', event: 'RESUBMIT', to: 'reviewing', allowedRoles: ['applicant'] },
  { from: 'pending_approval', event: 'WITHDRAW', to: 'withdrawn', allowedRoles: ['applicant'] },
  { from: 'pending_final_approval', event: 'WITHDRAW', to: 'withdrawn', allowedRoles: ['applicant'] },
  { from: 'needs_info', event: 'WITHDRAW', to: 'withdrawn', allowedRoles: ['applicant'] },
]

// 找出「這個狀態、這個事件、而且條件成立」的那一條規則
const passes = (t: Transition, ctx: TransitionContext) => !t.when || GUARDS[t.when](ctx)

// 回傳值用「成功或失敗」的物件，而不是丟出例外（throw）
// 呼叫端被 TypeScript 強迫處理失敗的情況，不會忘記
export type TransitionResult =
  | { ok: true; next: RequestStatus }
  | { ok: false; reason: 'invalid_transition' | 'forbidden' }

export function transition(
  current: RequestStatus,
  event: RequestEvent,
  role: ActorRole,
  ctx: TransitionContext = NO_CONTEXT,
): TransitionResult {
  const rule = TRANSITIONS.find((t) => t.from === current && t.event === event && passes(t, ctx))

  // 這個狀態根本不能接這個事件，例如「已核准」的單又被核准一次
  if (!rule) return { ok: false, reason: 'invalid_transition' }

  // 事件本身合法，但這個角色沒有權限，例如申請人想核准自己的單
  if (!rule.allowedRoles.includes(role)) return { ok: false, reason: 'forbidden' }

  return { ok: true, next: rule.to }
}

// 給前端用：在目前狀態下，這個角色可以做哪些事？（用來決定顯示哪些按鈕）
// 用 Set 去除重複：主管核准有兩條規則（送廠長、直接結案），但按鈕只要一個
export function availableEvents(
  current: RequestStatus,
  role: ActorRole,
  ctx: TransitionContext = NO_CONTEXT,
): RequestEvent[] {
  const events = TRANSITIONS.filter(
    (t) => t.from === current && t.allowedRoles.includes(role) && passes(t, ctx),
  ).map((t) => t.event)
  return [...new Set(events)]
}

// 終點狀態：之後不會再有任何轉換
export function isFinal(status: RequestStatus): boolean {
  return !TRANSITIONS.some((t) => t.from === status)
}

// 會簽核申請單的角色
export const APPROVER_ROLES: readonly ActorRole[] = ['approver', 'plant_manager']
export const isApproverRole = (role: ActorRole) => APPROVER_ROLES.includes(role)

// 每個簽核角色負責哪一個「待簽」狀態：清單頁的「待我簽核」就是用它篩選
export const PENDING_STATUS_FOR: Partial<Record<ActorRole, RequestStatus>> = {
  approver: 'pending_approval',
  plant_manager: 'pending_final_approval',
}
