import { randomUUID } from 'node:crypto'
import { transition, type ActorRole, type RequestEvent } from '@ai-approval/shared'
import { POLICY_CHUNKS } from './policies'
import { validateCitations, type Reviewer } from './reviewer'
import type { ApprovalRequest, Store } from './store'

export interface CurrentUser {
  id: string
  role: ActorRole
}

// AI 審查員在系統裡的身分：只有它能送出 AI_REVIEW_DONE / AI_REVIEW_FAILED
const AI_ACTOR: CurrentUser = { id: 'ai-reviewer', role: 'system' }

// 業務邏輯層：只關心「規則」，完全不知道 HTTP、Express 的存在
// 好處是可以直接單元測試，不用啟動伺服器
// reviewer 是選填的：沒給的話就不會自動預審（舊的測試可以照常手動推進狀態）
export function createRequestService(store: Store, reviewer?: Reviewer) {
  // 正在跑的預審：讓測試可以「等它跑完」再檢查結果
  const pendingReviews = new Map<string, Promise<void>>()

  function createRequest(user: CurrentUser, input: { title: string; description: string }) {
    const now = new Date().toISOString()
    const request: ApprovalRequest = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      applicantId: user.id,
      status: 'draft',
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    store.saveRequest(request)
    store.appendAudit({
      id: randomUUID(),
      requestId: request.id,
      actor: user,
      event: 'CREATE',
      from: null,
      to: 'draft',
      at: now,
    })
    return request
  }

  type SendEventResult =
    | { ok: true; request: ApprovalRequest }
    | { ok: false; reason: 'not_found' | 'forbidden' | 'invalid_transition' }

  function sendEvent(requestId: string, event: RequestEvent, user: CurrentUser): SendEventResult {
    const request = store.getRequest(requestId)
    if (!request) return { ok: false, reason: 'not_found' }

    // 狀態機只管「申請人這個角色能不能撤回」，
    // 但「這張單是不是你的」是另一層規則：申請人只能動自己的單
    if (user.role === 'applicant' && request.applicantId !== user.id) {
      return { ok: false, reason: 'forbidden' }
    }

    // 規則全部交給 shared 的狀態機判斷，這裡不重寫任何 if-else
    const result = transition(request.status, event, user.role)
    if (!result.ok) return result

    const now = new Date().toISOString()
    const updated: ApprovalRequest = {
      ...request,
      status: result.next,
      version: event === 'RESUBMIT' ? request.version + 1 : request.version,
      updatedAt: now,
    }
    store.saveRequest(updated)
    store.appendAudit({
      id: randomUUID(),
      requestId,
      actor: user,
      event,
      from: request.status,
      to: result.next,
      at: now,
    })

    // 一進入 reviewing 就在背景啟動預審，不等它跑完就先回應
    // 使用者會立刻看到「預審中」，而不是卡在一個要轉 10 秒的請求
    if (updated.status === 'reviewing' && reviewer) {
      const job = runReview(updated.id, updated.version, reviewer)
      pendingReviews.set(updated.id, job)
    }

    return { ok: true, request: updated }
  }

  async function runReview(requestId: string, version: number, reviewer: Reviewer) {
    const request = store.getRequest(requestId)
    if (!request) return

    let outcome: 'done' | 'failed'
    try {
      const raw = await reviewer.review(
        { title: request.title, description: request.description },
        POLICY_CHUNKS,
      )
      const output = validateCitations(raw, POLICY_CHUNKS)
      store.appendReview({
        id: randomUUID(),
        requestId,
        requestVersion: version,
        status: 'done',
        ...output,
        reviewer: reviewer.name,
        createdAt: new Date().toISOString(),
      })
      outcome = 'done'
    } catch (err) {
      store.appendReview({
        id: randomUUID(),
        requestId,
        requestVersion: version,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        reviewer: reviewer.name,
        createdAt: new Date().toISOString(),
      })
      outcome = 'failed'
    }

    // 過期檢查：AI 思考的這段時間，申請單可能已經被撤回、或補件成新版本
    // 這時候的結果就作廢，不能拿舊版本的審查結果去推進新版本的狀態
    const latest = store.getRequest(requestId)
    if (!latest || latest.version !== version || latest.status !== 'reviewing') return

    sendEvent(requestId, outcome === 'done' ? 'AI_REVIEW_DONE' : 'AI_REVIEW_FAILED', AI_ACTOR)
  }

  // 取得「對應目前版本」的最新預審結果
  function getLatestReview(requestId: string) {
    const request = store.getRequest(requestId)
    if (!request) return undefined
    return store
      .listReviews(requestId)
      .filter((r) => r.requestVersion === request.version)
      .at(-1)
  }

  return {
    createRequest,
    sendEvent,
    getLatestReview,
    getRequest: (id: string) => store.getRequest(id),
    listRequests: () => store.listRequests(),
    getHistory: (id: string) => store.listAudit(id),
    // 測試用：等背景預審跑完
    waitForReview: (id: string) => pendingReviews.get(id) ?? Promise.resolve(),
  }
}

export type RequestService = ReturnType<typeof createRequestService>
