import { randomUUID } from 'node:crypto'
import { transition, type ActorRole, type RequestEvent, type RequestStatus } from '@ai-approval/shared'
import { POLICY_CHUNKS } from './policies'
import { validateCitations, validateFinding, type ReviewFinding, type Reviewer } from './reviewer'
import type { ApprovalRequest, Store } from './store'

export interface CurrentUser {
  id: string
  role: ActorRole
}

// 推播給前端的事件：
// - finding：AI 剛審出一條意見
// - status：申請單狀態變了（前端看到不是 reviewing 了，就知道可以收工）
export type ReviewStreamEvent =
  | { type: 'finding'; version: number; finding: ReviewFinding }
  | { type: 'status'; status: RequestStatus }

type Listener = (event: ReviewStreamEvent) => void

// AI 審查員在系統裡的身分：只有它能送出 AI_REVIEW_DONE / AI_REVIEW_FAILED
const AI_ACTOR: CurrentUser = { id: 'ai-reviewer', role: 'system' }

// AI 超過這個時間還沒回應就放棄，走預審失敗的流程，不讓申請單卡在 reviewing
const REVIEW_TIMEOUT_MS = 60_000

// 業務邏輯層：只關心「規則」，完全不知道 HTTP、Express 的存在
// reviewer 是選填的：沒給的話就不會自動預審（舊的測試可以照常手動推進狀態）
export function createRequestService(store: Store, reviewer?: Reviewer) {
  // 正在跑的預審：讓測試可以「等它跑完」再檢查結果
  const pendingReviews = new Map<string, Promise<void>>()

  // 每張申請單有哪些人正在看（訂閱者）
  const listeners = new Map<string, Set<Listener>>()

  // 預審進行中、已經審出來的意見
  // 晚一點才打開頁面的人，要先補發這些，不然會漏掉前面幾條
  const inProgress = new Map<string, { version: number; findings: ReviewFinding[] }>()

  function publish(requestId: string, event: ReviewStreamEvent) {
    listeners.get(requestId)?.forEach((listener) => listener(event))
  }

  function subscribe(requestId: string, listener: Listener) {
    // 先補發：目前狀態 + 已經審出來的意見
    const request = store.getRequest(requestId)
    const buffered = inProgress.get(requestId)
    if (buffered) {
      for (const finding of buffered.findings) {
        listener({ type: 'finding', version: buffered.version, finding })
      }
    }
    if (request) listener({ type: 'status', status: request.status })

    // 再加入訂閱名單，之後的新事件會即時收到
    let set = listeners.get(requestId)
    if (!set) listeners.set(requestId, (set = new Set()))
    set.add(listener)

    // 回傳「取消訂閱」的函式：使用者關掉頁面時呼叫，避免記憶體洩漏
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(requestId)
    }
  }

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
    publish(requestId, { type: 'status', status: updated.status })

    // 一進入 reviewing 就在背景啟動預審，不等它跑完就先回應
    if (updated.status === 'reviewing' && reviewer) {
      const job = runReview(updated.id, updated.version, reviewer)
      pendingReviews.set(updated.id, job)
    }

    return { ok: true, request: updated }
  }

  async function runReview(requestId: string, version: number, reviewer: Reviewer) {
    const request = store.getRequest(requestId)
    if (!request) return

    const buffer = { version, findings: [] as ReviewFinding[] }
    inProgress.set(requestId, buffer)

    let outcome: 'done' | 'failed'
    try {
      const raw = await reviewer.review(
        { title: request.title, description: request.description },
        POLICY_CHUNKS,
        {
          signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
          // 每審出一條：先驗證引用，再存進暫存區、推播給正在看的人
          onFinding: (f) => {
            const finding = validateFinding(f, POLICY_CHUNKS)
            buffer.findings.push(finding)
            publish(requestId, { type: 'finding', version, finding })
          },
        },
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
      const isTimeout = err instanceof Error && err.name === 'TimeoutError'
      store.appendReview({
        id: randomUUID(),
        requestId,
        requestVersion: version,
        status: 'failed',
        error: isTimeout ? 'AI 回應逾時' : err instanceof Error ? err.message : String(err),
        reviewer: reviewer.name,
        createdAt: new Date().toISOString(),
      })
      outcome = 'failed'
    } finally {
      inProgress.delete(requestId)
    }

    // 過期檢查：AI 思考的這段時間，申請單可能已經被撤回、或補件成新版本
    // 這時候的結果就作廢，不能拿舊版本的審查結果去推進新版本的狀態
    const latest = store.getRequest(requestId)
    if (!latest || latest.version !== version || latest.status !== 'reviewing') return

    sendEvent(requestId, outcome === 'done' ? 'AI_REVIEW_DONE' : 'AI_REVIEW_FAILED', AI_ACTOR)
  }

  // 伺服器啟動時呼叫：找出「預審到一半伺服器就停掉」的申請單，重新跑一次
  // 資料存在記憶體時不會有這個問題（重開就全部消失），換成持久化之後才需要處理：
  // 不然這些單會永遠卡在 reviewing，因為沒有人會再送出 AI_REVIEW_DONE
  function resumeInterruptedReviews() {
    if (!reviewer) return 0
    const stuck = store.listRequests().filter((r) => r.status === 'reviewing')
    for (const r of stuck) {
      pendingReviews.set(r.id, runReview(r.id, r.version, reviewer))
    }
    return stuck.length
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
    subscribe,
    resumeInterruptedReviews,
    getLatestReview,
    getRequest: (id: string) => store.getRequest(id),
    listRequests: () => store.listRequests(),
    getHistory: (id: string) => store.listAudit(id),
    // 測試用：等背景預審跑完
    waitForReview: (id: string) => pendingReviews.get(id) ?? Promise.resolve(),
  }
}

export type RequestService = ReturnType<typeof createRequestService>
