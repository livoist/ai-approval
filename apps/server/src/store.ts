import type { ActorRole, RequestEvent, RequestStatus } from '@ai-approval/shared'

export interface ApprovalRequest {
  id: string
  title: string
  description: string
  applicantId: string
  status: RequestStatus
  version: number // 每次補件重送 +1，之後用來判斷 AI 預審結果是否過期
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

// 暫時用記憶體當資料庫：重開伺服器資料就會消失
// 先把流程做對，之後換成 SQLite 時只需要改這個檔案
export function createStore() {
  const requests = new Map<string, ApprovalRequest>()
  const audit: AuditEvent[] = []

  return {
    getRequest: (id: string) => requests.get(id),
    listRequests: () => [...requests.values()],
    saveRequest: (r: ApprovalRequest) => {
      requests.set(r.id, r)
    },
    appendAudit: (e: AuditEvent) => {
      audit.push(e)
    },
    listAudit: (requestId: string) => audit.filter((e) => e.requestId === requestId),
  }
}

export type Store = ReturnType<typeof createStore>
