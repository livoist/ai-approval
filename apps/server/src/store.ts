import type { ActorRole, RequestEvent, RequestStatus } from '@ai-approval/shared'
import type { ReviewFinding } from './reviewer'

export interface ApprovalRequest {
  id: string
  title: string
  description: string
  applicantId: string
  status: RequestStatus
  version: number // 每次補件重送 +1，用來判斷 AI 預審結果是否過期
  createdAt: string
  updatedAt: string
}

// 審計紀錄：只新增、不修改、不刪除
// 申請單的「歷史」不是存在申請單本身，而是由這些事件記錄下來的
export interface AuditEvent {
  id: string
  requestId: string
  actor: { id: string; role: ActorRole }
  event: RequestEvent | 'CREATE'
  from: RequestStatus | null
  to: RequestStatus
  at: string
}

// AI 預審結果：記下它審的是「哪個版本」的申請單
export interface AiReview {
  id: string
  requestId: string
  requestVersion: number
  status: 'done' | 'failed'
  riskLevel?: 'low' | 'medium' | 'high'
  summary?: string
  findings?: ReviewFinding[]
  error?: string
  reviewer: string // 用哪個模型（或 mock）審的
  createdAt: string
}

// 資料層的「合約」：service 只依賴這個介面
// 記憶體版、SQLite 版都要實作同一組方法，service 完全不知道資料存在哪裡
export interface Store {
  getRequest(id: string): ApprovalRequest | undefined
  listRequests(): ApprovalRequest[]
  saveRequest(r: ApprovalRequest): void
  appendAudit(e: AuditEvent): void
  listAudit(requestId: string): AuditEvent[]
  appendReview(r: AiReview): void
  listReviews(requestId: string): AiReview[]
}

// 記憶體版：重開伺服器資料就會消失，但速度快、不用檔案，適合跑測試
export function createStore(): Store {
  const requests = new Map<string, ApprovalRequest>()
  const audit: AuditEvent[] = []
  const reviews: AiReview[] = []

  return {
    getRequest: (id) => requests.get(id),
    listRequests: () => [...requests.values()],
    saveRequest: (r) => {
      requests.set(r.id, r)
    },
    appendAudit: (e) => {
      audit.push(e)
    },
    listAudit: (requestId) => audit.filter((e) => e.requestId === requestId),
    appendReview: (r) => {
      reviews.push(r)
    },
    listReviews: (requestId) => reviews.filter((r) => r.requestId === requestId),
  }
}
