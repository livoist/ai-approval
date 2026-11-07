import type { ActorRole, AuditAction, Finding, FormValues, RequestStatus } from '@ai-approval/shared'
import type { EvalReport } from './evals'

export interface ApprovalRequest {
  id: string
  formType: string // 用哪一份表單定義（目前只有 maintenance）
  title: string
  fields: FormValues // 表單填寫內容，結構由表單定義決定
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
  event: AuditAction
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
  findings?: Finding[] // 規則引擎與 AI 的意見，依序排列
  error?: string
  reviewer: string // 用哪個模型（或 mock）審的
  // 檢索：這次交給 AI 的是哪幾條規範。AI 只看得到這些，也只能引用這些
  // 事後回頭查「AI 為什麼沒提到某條規定」時，先看它到底有沒有看到
  retrievedPolicyIds?: string[]
  // 這次套用了哪些審查準則（主管的回饋轉成的提醒）
  appliedGuidelineIds?: string[]
  // 送給 AI 前遮罩了哪些個資（只記種類與數量，不記內容）
  maskedPii?: { label: string; count: number }[]
  createdAt: string
}

// 審查準則：主管標記「AI 有誤」的理由，經管理者採用後，之後的預審會一併交給 AI
// 例如「一般報修只要說明現象與發生時間就夠了，不必要求完整紀錄」
// 停用不是刪除：過去的預審套用過它，要查得到當時 AI 拿到的是什麼
export interface Guideline {
  id: string
  policyId: string // 針對哪一條規範
  text: string
  sourceFeedbackId: string | null // 從哪一筆主管評價來的
  createdBy: string
  createdAt: string
  retiredAt: string | null
  retiredBy: string | null
}

// 一次評估：同一組案例，分別在「不套用準則」與「套用準則」下各跑一次
export interface EvalRun {
  id: string
  reviewer: string
  guidelineIds: string[]
  createdBy: string
  createdAt: string
  report: EvalReport
}

// 主管匯入的規範文件（內建的規範寫在 policies.ts，不存在資料庫）
export interface StoredPolicyDoc {
  id: string // 代碼，也是條文 id 的前綴：trv → trv-1、trv-2……
  formType: string // 給哪一種申請單用
  title: string
  fileName: string | null
  createdBy: string
  createdAt: string
}

export interface StoredPolicyChunk {
  id: string
  docId: string
  section: string
  text: string
}

// 主管對 AI 某一條意見的評價
// 不直接改 AiReview，而是另外記一筆：AI 說了什麼、人怎麼判斷，兩者永遠分得清楚
export interface FindingFeedback {
  id: string
  reviewId: string
  findingIndex: number // 第幾條意見（從 0 開始）
  verdict: 'correct' | 'incorrect'
  note: string // 標記有誤時必填：錯在哪裡
  actorId: string
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
  appendFeedback(f: FindingFeedback): void
  listFeedback(reviewId: string): FindingFeedback[]
  // 文件與它的條文一起寫入：要嘛全部成功，要嘛全部沒發生，不會只存了一半的條文
  appendPolicyDoc(doc: StoredPolicyDoc, chunks: StoredPolicyChunk[]): void
  listPolicyDocs(): StoredPolicyDoc[]
  listPolicyChunks(): StoredPolicyChunk[] // 依文件匯入順序、條文在文件中的順序
  appendGuideline(g: Guideline): void
  listGuidelines(): Guideline[] // 依建立順序，包含已停用的
  retireGuideline(id: string, by: string, at: string): void
  appendEvalRun(run: EvalRun): void
  listEvalRuns(): EvalRun[] // 依執行順序
}

// 記憶體版：重開伺服器資料就會消失，但速度快、不用檔案，適合跑測試
export function createStore(): Store {
  const requests = new Map<string, ApprovalRequest>()
  const audit: AuditEvent[] = []
  const reviews: AiReview[] = []
  const feedback: FindingFeedback[] = []
  const policyDocs: StoredPolicyDoc[] = []
  const policyChunks: StoredPolicyChunk[] = []
  const guidelines: Guideline[] = []
  const evalRuns: EvalRun[] = []

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
    appendFeedback: (f) => {
      feedback.push(f)
    },
    listFeedback: (reviewId) => feedback.filter((f) => f.reviewId === reviewId),
    appendPolicyDoc: (doc, chunks) => {
      // 跟 SQLite 的主鍵一樣：id 重複就整筆拒絕，而且要在改任何資料之前檢查
      if (policyDocs.some((d) => d.id === doc.id)) throw new Error(`policy doc ${doc.id} already exists`)
      const ids = new Set(policyChunks.map((c) => c.id))
      for (const c of chunks) {
        if (ids.has(c.id)) throw new Error(`policy chunk ${c.id} already exists`)
        ids.add(c.id)
      }
      policyDocs.push(doc)
      policyChunks.push(...chunks)
    },
    listPolicyDocs: () => [...policyDocs],
    listPolicyChunks: () => [...policyChunks],
    appendGuideline: (g) => {
      guidelines.push(g)
    },
    // 回傳複本：呼叫端改了物件，也不會偷偷改到「資料庫」裡的資料（SQLite 版本來就是這樣）
    listGuidelines: () => guidelines.map((g) => ({ ...g })),
    retireGuideline: (id, by, at) => {
      const g = guidelines.find((x) => x.id === id)
      if (g && !g.retiredAt) Object.assign(g, { retiredAt: at, retiredBy: by })
    },
    appendEvalRun: (run) => {
      evalRuns.push(run)
    },
    listEvalRuns: () => [...evalRuns],
  }
}
