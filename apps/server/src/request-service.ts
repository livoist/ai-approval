import { randomUUID } from 'node:crypto'
import { transition, type ActorRole, type RequestEvent } from '@ai-approval/shared'
import type { ApprovalRequest, Store } from './store'

export interface CurrentUser {
  id: string
  role: ActorRole
}

// 業務邏輯層：只關心「規則」，完全不知道 HTTP、Express 的存在
// 好處是可以直接單元測試，不用啟動伺服器
export function createRequestService(store: Store) {
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
    return { ok: true, request: updated }
  }

  return {
    createRequest,
    sendEvent,
    getRequest: (id: string) => store.getRequest(id),
    listRequests: () => store.listRequests(),
    getHistory: (id: string) => store.listAudit(id),
  }
}

export type RequestService = ReturnType<typeof createRequestService>
