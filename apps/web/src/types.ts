import type { ActorRole, AuditAction, Finding, FormType, FormValues, RequestStatus } from '@ai-approval/shared'

// 後端 API 回傳的資料形狀
// 目前跟 apps/server/src/store.ts 各寫一份；之後可以搬到 shared，讓前後端只維護一份

export interface ApprovalRequest {
  id: string
  formType: FormType
  title: string
  fields: FormValues
  applicantId: string
  status: RequestStatus
  version: number
  createdAt: string
  updatedAt: string
}

// 清單頁的資料：申請單 + 目前版本的風險等級（還沒預審的是 null）
export interface RequestSummary extends ApprovalRequest {
  riskLevel: 'low' | 'medium' | 'high' | null
}

export interface AuditEvent {
  id: string
  actor: { id: string; role: ActorRole }
  event: AuditAction
  from: RequestStatus | null
  to: RequestStatus
  at: string
}

export interface FindingFeedback {
  id: string
  verdict: 'correct' | 'incorrect'
  note: string
  actorId: string
  createdAt: string
}

// 預審意見（規則引擎或 AI 產生，見 shared 的 Finding）再加上主管最新的評價
// 串流中的意見還沒有評價，所以是選填
export interface ReviewFinding extends Finding {
  feedback?: FindingFeedback | null
}

export interface AiReview {
  id: string
  requestVersion: number
  status: 'done' | 'failed'
  riskLevel?: 'low' | 'medium' | 'high'
  summary?: string
  findings?: ReviewFinding[]
  error?: string
  reviewer: string
}

export interface RequestDetail extends ApprovalRequest {
  history: AuditEvent[]
  review: AiReview | null
}

// SSE 推播的事件，跟 apps/server/src/request-service.ts 的 ReviewStreamEvent 一致
export type ReviewStreamEvent =
  | { type: 'finding'; version: number; finding: ReviewFinding }
  | { type: 'status'; status: RequestStatus }

// 系統資訊：公開 demo 時用來顯示提示與 AI 額度
export interface AppMeta {
  demo: boolean
  ai: { reviewer: string; used: number; limit: number } | null
}

export interface PolicyChunk {
  id: string
  docId: string
  docTitle: string
  section: string
  text: string
}
