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
  retrievedPolicyIds?: string[] // 這次交給 AI 的條文
  appliedGuidelineIds?: string[] // 這次套用的審查準則
  maskedPii?: { label: string; count: number }[] // 送給 AI 前遮罩的個資種類與數量
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

// AI 準確度統計，跟 apps/server/src/ai-stats.ts 的 AiStats 一致
// 「未評價」= total - correct - incorrect
export interface VerdictCounts {
  total: number
  correct: number
  incorrect: number
}

export interface AiStats {
  totals: { reviews: number; ruleFindings: number; aiFindings: VerdictCounts }
  daily: ({ date: string } & VerdictCounts)[]
  byPolicy: ({ policyId: string | null; docTitle: string; section: string; text: string } & VerdictCounts)[]
  byFormType: { formType: FormType; title: string; ruleFindings: number; aiFindings: VerdictCounts }[]
  byReviewer: ({ reviewer: string } & VerdictCounts)[]
  recentIncorrect: {
    feedbackId: string
    policyId: string | null
    adoptedGuidelineId: string | null
    requestId: string
    title: string
    formType: FormType
    message: string
    citations: string[]
    note: string
    actorId: string
    at: string
  }[]
}

// 規範文件：內建的寫在後端程式裡，upload 是主管匯入的
export interface PolicyDocSummary {
  id: string
  formType: FormType
  title: string
  source: 'builtin' | 'upload'
  fileName: string | null
  createdBy: string | null
  createdAt: string | null
  chunkCount: number
}

export interface ArticleDraft {
  section: string
  text: string
  suspicious?: boolean // 疑似包含給 AI 的指令，請主管特別確認
}

// 上傳 PDF 後，後端切好的條文草稿（還沒存起來）
export interface PolicyImportPreview {
  title: string
  articles: ArticleDraft[]
  pages: number
}

// ===== AI 調校：審查準則與評估集（跟 apps/server/src/store.ts、evals.ts 一致）=====
export interface Guideline {
  id: string
  policyId: string
  text: string
  sourceFeedbackId: string | null
  createdBy: string
  createdAt: string
  retiredAt: string | null
  retiredBy: string | null
}

export interface EvalSummary {
  total: number
  passed: number
  expected: number
  caught: number
  falseAlarms: number
}

export interface EvalCaseResult {
  caseId: string
  passed: boolean
  cited: string[]
  missed: string[]
  falseAlarms: string[]
  findings: { message: string; citations: string[] }[]
  reviewer: string
  error?: string
}

export interface EvalReport {
  cases: { id: string; name: string; why: string; formType: FormType; shouldFlag: string[]; shouldNotFlag: string[] }[]
  guidelines: { id: string; policyId: string; text: string }[]
  baseline: { results: EvalCaseResult[]; summary: EvalSummary }
  withGuidelines: { results: EvalCaseResult[]; summary: EvalSummary }
}

export interface EvalRun {
  id: string
  reviewer: string
  guidelineIds: string[]
  createdBy: string
  createdAt: string
  report: EvalReport
}

// 歷史清單用的摘要：不含每一題的細節
export type EvalRunSummary = Omit<EvalRun, 'report'> & { baseline: EvalSummary; withGuidelines: EvalSummary }

// 正在執行的評估進度（只有在跑的時候才有數字）
export type EvalProgress =
  | { running: false }
  | { running: true; done: number; total: number; startedAt: string; startedBy: string }
