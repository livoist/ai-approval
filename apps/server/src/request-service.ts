import { randomUUID } from 'node:crypto'
import {
  describeValues,
  getFormKind,
  isApproverRole,
  isFormType,
  needsPlantManager,
  normalizeValues,
  runRules,
  transition,
  validateValues,
  type ActorRole,
  type Finding,
  type FormType,
  type FormValues,
  type RequestEvent,
  type RequestStatus,
} from '@ai-approval/shared'
import { computeAiStats } from './ai-stats'
import { CORE_POLICIES, createPolicyLibrary, type PolicyImportInput } from './policies'
import { selectRelevant } from './retrieval'
import { validateCitations, validateFinding, type Reviewer } from './reviewer'
import type { ApprovalRequest, FindingFeedback, Store } from './store'

export interface CurrentUser {
  id: string
  role: ActorRole
}

// 推播給前端的事件：
// - finding：剛審出一條意見（規則引擎的會立刻出現，AI 的陸續出現）
// - status：申請單狀態變了（前端看到不是 reviewing 了，就知道可以收工）
export type ReviewStreamEvent =
  | { type: 'finding'; version: number; finding: Finding }
  | { type: 'status'; status: RequestStatus }

type Listener = (event: ReviewStreamEvent) => void

// AI 審查員在系統裡的身分：只有它能送出 AI_REVIEW_DONE / AI_REVIEW_FAILED
const AI_ACTOR: CurrentUser = { id: 'ai-reviewer', role: 'system' }

// 每次預審最多交給 AI 幾條規範（另外加上規則已經引用的）
// 內建的規範都在這個數量以內，所以全部會給；主管匯入更多文件之後，才開始依相關程度挑選
export const POLICY_TOP_K = 10

// AI 超過這個時間還沒回應就放棄，走預審失敗的流程，不讓申請單卡在 reviewing
const REVIEW_TIMEOUT_MS = 60_000

type RiskLevel = 'low' | 'medium' | 'high'
const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high']
const maxRisk = (a: RiskLevel, b: RiskLevel) => (RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b)

// 規則引擎的風險：缺少規範要求的東西 → 高；有安全疑慮 → 中；只是流程提醒 → 低
function riskFromRules(findings: Finding[]): RiskLevel {
  if (findings.some((f) => f.kind === 'missing')) return 'high'
  if (findings.some((f) => f.kind === 'risk')) return 'medium'
  return 'low'
}

export interface ServiceOptions {
  // 「現在幾點」也從外面傳進來：測試可以固定時間，示範資料可以放在過去幾天
  now?: () => Date
}

// 業務邏輯層：只關心「規則」，完全不知道 HTTP、Express 的存在
// reviewer 是選填的：沒給的話就不會自動預審（舊的測試可以照常手動推進狀態）
export function createRequestService(store: Store, reviewer?: Reviewer, options: ServiceOptions = {}) {
  const now = options.now ?? (() => new Date())
  const policyLibrary = createPolicyLibrary(store)

  // 正在跑的預審：讓測試可以「等它跑完」再檢查結果
  const pendingReviews = new Map<string, Promise<void>>()

  // 每張申請單有哪些人正在看（訂閱者）
  const listeners = new Map<string, Set<Listener>>()

  // 預審進行中、已經審出來的意見
  // 晚一點才打開頁面的人，要先補發這些，不然會漏掉前面幾條
  const inProgress = new Map<string, { version: number; findings: Finding[] }>()

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

  // 用表單定義檢查填寫內容：格式錯誤一律擋下，不讓不合法的資料進資料庫
  // 跟前端用的是同一個 validateValues，所以前端擋得住的，後端一定也擋得住
  type FormInput = { title: string; fields: FormValues }
  type CreateInput = FormInput & { formType: unknown }
  type FormCheck =
    | { ok: true; title: string; fields: FormValues }
    | { ok: false; reason: 'invalid_fields'; fieldErrors: Record<string, string> }

  // 用「這種申請單」的表單定義檢查：設備維修跟費用報銷的欄位、規則完全不同，但檢查的方式一樣
  function checkForm(formType: FormType, input: FormInput): FormCheck {
    const { def } = getFormKind(formType)
    const fieldErrors = validateValues(def, input.fields)
    if (input.title.trim() === '') fieldErrors.title = '請填寫標題'
    if (Object.keys(fieldErrors).length > 0) return { ok: false, reason: 'invalid_fields', fieldErrors }
    return { ok: true, title: input.title.trim(), fields: normalizeValues(def, input.fields) }
  }

  type CreateResult =
    | { ok: true; request: ApprovalRequest }
    | { ok: false; reason: 'forbidden' | 'unknown_form_type' }
    | Extract<FormCheck, { ok: false }>

  function createRequest(user: CurrentUser, input: CreateInput): CreateResult {
    if (user.role !== 'applicant') return { ok: false, reason: 'forbidden' }
    if (!isFormType(input.formType)) return { ok: false, reason: 'unknown_form_type' }
    const form = checkForm(input.formType, input)
    if (!form.ok) return form

    const at = now().toISOString()
    const request: ApprovalRequest = {
      id: randomUUID(),
      formType: input.formType,
      title: form.title,
      fields: form.fields,
      applicantId: user.id,
      status: 'draft',
      version: 1,
      createdAt: at,
      updatedAt: at,
    }
    store.saveRequest(request)
    store.appendAudit({
      id: randomUUID(),
      requestId: request.id,
      actor: user,
      event: 'CREATE',
      from: null,
      to: 'draft',
      at,
    })
    return { ok: true, request }
  }

  type UpdateResult =
    | { ok: true; request: ApprovalRequest }
    | { ok: false; reason: 'not_found' | 'forbidden' | 'invalid_transition' }
    | Extract<FormCheck, { ok: false }>

  // 修改申請內容：只有申請人本人、而且只在「草稿」或「待補件」時可以改
  // 這不是狀態轉換（改完狀態不變），但一樣要留下紀錄
  function updateRequest(requestId: string, user: CurrentUser, input: FormInput): UpdateResult {
    const request = store.getRequest(requestId)
    if (!request) return { ok: false, reason: 'not_found' }
    if (user.role !== 'applicant' || request.applicantId !== user.id) {
      return { ok: false, reason: 'forbidden' }
    }
    if (request.status !== 'draft' && request.status !== 'needs_info') {
      return { ok: false, reason: 'invalid_transition' }
    }
    // 申請單類型建立後就不能改：設備維修單不能改成報銷單
    const form = checkForm(request.formType as FormType, input)
    if (!form.ok) return form

    const at = now().toISOString()
    const updated: ApprovalRequest = { ...request, title: form.title, fields: form.fields, updatedAt: at }
    store.saveRequest(updated)
    store.appendAudit({
      id: randomUUID(),
      requestId,
      actor: user,
      event: 'UPDATE',
      from: request.status,
      to: request.status,
      at,
    })
    return { ok: true, request: updated }
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
    // 這張單要不要送廠長，由規則引擎依內容判斷；狀態機用它選出正確的下一步
    const ctx = { needsPlantManager: needsPlantManager(request.formType as FormType, request.fields, now()) }
    const result = transition(request.status, event, user.role, ctx)
    if (!result.ok) return result

    const at = now().toISOString()
    const updated: ApprovalRequest = {
      ...request,
      status: result.next,
      version: event === 'RESUBMIT' ? request.version + 1 : request.version,
      updatedAt: at,
    }
    store.saveRequest(updated)
    store.appendAudit({
      id: randomUUID(),
      requestId,
      actor: user,
      event,
      from: request.status,
      to: result.next,
      at,
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

    const buffer = { version, findings: [] as Finding[] }
    inProgress.set(requestId, buffer)
    const emit = (finding: Finding) => {
      buffer.findings.push(finding)
      publish(requestId, { type: 'finding', version, finding })
    }

    // 第一步：規則引擎。純程式判斷、瞬間完成，所以這些意見會最先出現在畫面上
    const formType = request.formType as FormType
    const kind = getFormKind(formType)
    const narrative = request.fields[kind.narrativeField]
    const details = describeValues(kind.def, request.fields)

    const ruleFindings = runRules(formType, request.fields, now())
    ruleFindings.forEach(emit)

    // 檢索：用申請單的內容當查詢，從規範庫挑出最相關的條文，只把這些交給 AI
    // 查詢只用標題與填寫的文字，不用欄位名稱：每張報銷單都有「發票號碼」這個欄位，
    // 拿欄位名稱去查，每次都會查到發票的條文，真正相關的反而被擠掉
    const query = [request.title, ...Object.values(request.fields).filter((v) => typeof v === 'string')].join('\n')
    const policies = selectRelevant(policyLibrary.forFormType(formType), query, {
      topK: POLICY_TOP_K,
      // 一定要給的：核心條文，以及規則已經引用的條文（AI 才知道規則查到的問題依據是什麼）
      mustInclude: [...CORE_POLICIES[formType], ...ruleFindings.flatMap((f) => f.citations)],
    })
    const retrievedPolicyIds = policies.map((p) => p.id)

    let outcome: 'done' | 'failed'
    try {
      // 第二步：AI。只負責規則做不到的模糊判斷，並且知道規則已經查到什麼，避免重複
      const raw = await reviewer.review(
        {
          formType,
          formTitle: kind.def.title,
          title: request.title,
          values: request.fields,
          details,
          narrative: typeof narrative === 'string' ? narrative : '',
          ruleFindings,
        },
        policies,
        {
          signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
          // 每審出一條：先驗證引用、標上來源，再推播給正在看的人
          onFinding: (f) => emit({ ...validateFinding(f, policies), source: 'ai' }),
        },
      )
      const ai = validateCitations(raw, policies)

      // 合併：規則的意見在前、AI 的在後；風險等級取兩邊較高的那一個
      store.appendReview({
        id: randomUUID(),
        requestId,
        requestVersion: version,
        status: 'done',
        riskLevel: maxRisk(riskFromRules(ruleFindings), ai.riskLevel),
        summary: ai.summary,
        findings: [...ruleFindings, ...ai.findings.map((f) => ({ ...f, source: 'ai' as const }))],
        reviewer: raw.usedReviewer ?? reviewer.name,
        retrievedPolicyIds,
        createdAt: now().toISOString(),
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
        retrievedPolicyIds,
        createdAt: now().toISOString(),
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

  // 取得「對應目前版本」的最新預審結果，並在每條意見附上主管最新的評價
  function getLatestReview(requestId: string) {
    const request = store.getRequest(requestId)
    if (!request) return undefined
    const review = store
      .listReviews(requestId)
      .filter((r) => r.requestVersion === request.version)
      .at(-1)
    if (!review) return undefined

    // 同一條意見可能被標記過好幾次（改主意），後寫的覆蓋先寫的
    const latest = new Map<number, FindingFeedback>()
    for (const f of store.listFeedback(review.id)) latest.set(f.findingIndex, f)

    return {
      ...review,
      findings: review.findings?.map((finding, i) => ({ ...finding, feedback: latest.get(i) ?? null })),
    }
  }

  type FeedbackResult =
    | { ok: true; feedback: FindingFeedback }
    | { ok: false; reason: 'not_found' | 'forbidden' | 'note_required' }

  // 主管評價 AI 的某一條意見
  // 這不是狀態轉換（不會改變申請單走到哪一步），所以不經過狀態機，規則寫在這裡
  function giveFeedback(
    requestId: string,
    reviewId: string,
    findingIndex: number,
    user: CurrentUser,
    input: { verdict: FindingFeedback['verdict']; note: string },
  ): FeedbackResult {
    if (!isApproverRole(user.role)) return { ok: false, reason: 'forbidden' }

    // 這次預審必須屬於這張申請單、而且真的有這一條意見
    const review = store.listReviews(requestId).find((r) => r.id === reviewId)
    if (!review?.findings?.[findingIndex]) return { ok: false, reason: 'not_found' }

    // 說 AI 錯了，就要說出錯在哪：沒有理由的「錯」沒辦法拿來改進 AI
    const note = input.note.trim()
    if (input.verdict === 'incorrect' && note === '') return { ok: false, reason: 'note_required' }

    const feedback: FindingFeedback = {
      id: randomUUID(),
      reviewId,
      findingIndex,
      verdict: input.verdict,
      note,
      actorId: user.id,
      createdAt: now().toISOString(),
    }
    store.appendFeedback(feedback)
    return { ok: true, feedback }
  }

  // 清單頁用：每張單附上目前版本的風險等級，主管才能一眼決定先看哪張
  // 還沒預審過（草稿）或預審失敗的單，風險等級是 null
  function listSummaries() {
    return store.listRequests().map((r) => ({
      ...r,
      riskLevel: getLatestReview(r.id)?.riskLevel ?? null,
    }))
  }

  // AI 準確度統計：主管的評價只有簽核者看得到，申請人看了也沒有用
  function getAiStats(user: CurrentUser) {
    if (!isApproverRole(user.role)) return { ok: false as const, reason: 'forbidden' as const }
    return { ok: true as const, stats: computeAiStats(store, { now: now() }) }
  }

  // ===== 規範庫 =====
  function importPolicyDoc(user: CurrentUser, input: PolicyImportInput) {
    // 規範由簽核者管理；申請人可以看，但不能改公司的規定
    if (!isApproverRole(user.role)) return { ok: false as const, reason: 'forbidden' as const }
    return policyLibrary.importDoc(input, user.id, now())
  }

  return {
    createRequest,
    getAiStats,
    importPolicyDoc,
    listPolicyDocs: () => policyLibrary.listDocs(),
    listPolicies: (type?: FormType) => (type ? policyLibrary.forFormType(type) : policyLibrary.all()),
    listSummaries,
    updateRequest,
    sendEvent,
    subscribe,
    resumeInterruptedReviews,
    getLatestReview,
    giveFeedback,
    getRequest: (id: string) => store.getRequest(id),
    listRequests: () => store.listRequests(),
    getHistory: (id: string) => store.listAudit(id),
    // 測試用：等背景預審跑完
    waitForReview: (id: string) => pendingReviews.get(id) ?? Promise.resolve(),
  }
}

export type RequestService = ReturnType<typeof createRequestService>
