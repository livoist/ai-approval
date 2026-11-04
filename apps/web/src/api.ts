import type { RequestEvent } from '@ai-approval/shared'
import { currentUser } from './session'
import type { ApprovalRequest, PolicyChunk, RequestDetail } from './types'

// 後端回傳的錯誤，保留狀態碼與原因，讓畫面可以顯示對應的訊息
export class ApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
  ) {
    super(`${status} ${reason}`)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // 假登入：把目前切換到的使用者放進 header，跟 curl 時手動加的一樣
      'x-user-id': currentUser.value.id,
      'x-user-role': currentUser.value.role,
      ...init?.headers,
    },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'unknown')
  return body as T
}

export const api = {
  listRequests: () => call<ApprovalRequest[]>('/requests'),
  getRequest: (id: string) => call<RequestDetail>(`/requests/${id}`),
  createRequest: (input: { title: string; description: string }) =>
    call<ApprovalRequest>('/requests', { method: 'POST', body: JSON.stringify(input) }),
  sendEvent: (id: string, event: RequestEvent) =>
    call<ApprovalRequest>(`/requests/${id}/events`, {
      method: 'POST',
      body: JSON.stringify({ event }),
    }),
  listPolicies: () => call<PolicyChunk[]>('/policies'),
}
