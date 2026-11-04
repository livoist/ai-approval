import type { ActorRole, RequestEvent, RequestStatus } from '@ai-approval/shared'

// 後端 API 回傳的資料形狀
// 目前跟 apps/server/src/store.ts 各寫一份；之後可以搬到 shared，讓前後端只維護一份

export interface ApprovalRequest {
  id: string
  title: string
  description: string
  applicantId: string
  status: RequestStatus
  version: number
  createdAt: string
  updatedAt: string
}

export interface AuditEvent {
  id: string
  actor: { id: string; role: ActorRole }
  event: RequestEvent | 'CREATE'
  from: RequestStatus | null
  to: RequestStatus
  at: string
}

export interface ReviewFinding {
  kind: 'missing' | 'risk' | 'ok'
  message: string
  citations: string[]
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

export interface PolicyChunk {
  id: string
  docTitle: string
  section: string
  text: string
}
