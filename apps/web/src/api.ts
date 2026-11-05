import { createSseParser, type FormType, type FormValues, type RequestEvent } from '@ai-approval/shared'
import { currentUser } from './session'
import type {
  ApprovalRequest,
  FindingFeedback,
  PolicyChunk,
  RequestDetail,
  AppMeta,
  AiStats,
  ArticleDraft,
  EvalRun,
  EvalRunSummary,
  Guideline,
  PolicyDocSummary,
  PolicyImportPreview,
  RequestSummary,
  ReviewStreamEvent,
} from './types'

// 後端回傳的錯誤，保留狀態碼與原因，讓畫面可以顯示對應的訊息
export class ApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    // 表單驗證失敗時，後端會回傳每個欄位的錯誤訊息
    public fieldErrors: Record<string, string> = {},
  ) {
    super(`${status} ${reason}`)
  }
}

function authHeaders() {
  // 假登入：把目前切換到的使用者放進 header，跟 curl 時手動加的一樣
  return { 'x-user-id': currentUser.value.id, 'x-user-role': currentUser.value.role }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'unknown', body?.fieldErrors)
  return body as T
}

export const api = {
  getMeta: () => call<AppMeta>('/meta'),
  listRequests: () => call<RequestSummary[]>('/requests'),
  getRequest: (id: string) => call<RequestDetail>(`/requests/${id}`),
  createRequest: (input: { formType: FormType; title: string; fields: FormValues }) =>
    call<ApprovalRequest>('/requests', { method: 'POST', body: JSON.stringify(input) }),
  updateRequest: (id: string, input: { title: string; fields: FormValues }) =>
    call<ApprovalRequest>(`/requests/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  sendEvent: (id: string, event: RequestEvent) =>
    call<ApprovalRequest>(`/requests/${id}/events`, {
      method: 'POST',
      body: JSON.stringify({ event }),
    }),
  // 只拿這種申請單依據的規範文件
  listPolicies: (formType: FormType) => call<PolicyChunk[]>(`/policies?formType=${formType}`),
  giveFeedback: (
    id: string,
    reviewId: string,
    index: number,
    input: { verdict: FindingFeedback['verdict']; note: string },
  ) =>
    call<FindingFeedback>(`/requests/${id}/reviews/${reviewId}/findings/${index}/feedback`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  // 規範文件
  listPolicyDocs: () => call<PolicyDocSummary[]>('/policy-docs'),
  // 直接把檔案當 body 送出，Content-Type 設成 application/pdf；不用 FormData，後端也不用裝 multipart 套件
  previewPolicyPdf: (file: File) =>
    call<PolicyImportPreview>('/policy-docs/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    }),
  importPolicyDoc: (input: { formType: FormType; code: string; title: string; fileName: string | null; articles: ArticleDraft[] }) =>
    call<PolicyDocSummary>('/policy-docs', { method: 'POST', body: JSON.stringify(input) }),
  // AI 調校：審查準則與評估集
  listGuidelines: () => call<Guideline[]>('/guidelines'),
  createGuideline: (input: { policyId: string; text: string; feedbackId: string | null }) =>
    call<Guideline>('/guidelines', { method: 'POST', body: JSON.stringify(input) }),
  retireGuideline: (id: string) => call<{ ok: true }>(`/guidelines/${id}/retire`, { method: 'POST' }),
  listEvalRuns: () => call<EvalRunSummary[]>('/evals'),
  getEvalRun: (id: string) => call<EvalRun>(`/evals/${id}`),
  startEval: () => call<EvalRun>('/evals', { method: 'POST' }),
  // AI 準確度統計：只有簽核者拿得到，其他人會收到 403
  getAiStats: () => call<AiStats>('/stats/ai'),
  streamReview,
}

// 訂閱申請單的即時事件（SSE）
//
// 為什麼不用瀏覽器內建的 EventSource？因為它「不能自訂 header」，
// 而我們的身分驗證放在 header 裡（正式系統的 Authorization: Bearer xxx 也一樣）。
// 所以改用 fetch 讀取串流，自己解析 SSE 格式，好處是還能用 AbortController 隨時中斷。
async function streamReview(
  id: string,
  onEvent: (event: ReviewStreamEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`/api/requests/${id}/stream`, { headers: authHeaders(), signal })
  if (!res.ok || !res.body) throw new ApiError(res.status, 'stream_failed')

  const feed = createSseParser((data) => onEvent(JSON.parse(data)))
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()

  // 一直讀到連線結束，或是外面呼叫 abort()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    feed(value)
  }
}
