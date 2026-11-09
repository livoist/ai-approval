import { describeValues, getFormKind, runRules, type Finding, type FormType, type FormValues } from '@ai-approval/shared'
import { createGuard, type GuardReport } from './guard'
import { CORE_POLICIES, type PolicyChunk } from './policies'
import { bm25Retriever, pickRelevant, type Retriever } from './retrieval'
import type { ReviewInput } from './reviewer'
import type { Guideline } from './store'

// 預審前的準備：規則引擎 → 輸入防護 → 檢索規範 → 挑出相關的審查準則 → 組成交給 AI 的輸入
//
// 抽成獨立的函式，是因為有兩個地方要用：
// - 真正的預審（request-service）
// - 評估集（evals）
// 兩邊用同一套準備流程，評估分數才代表真正預審時的表現；各寫一份的話，遲早會不一樣

// 每次預審最多交給 AI 幾條規範（另外加上核心條文與規則已經引用的）
// 內建的規範都在這個數量以內，所以全部會給；主管匯入更多文件之後，才開始依相關程度挑選
export const POLICY_TOP_K = 10

export interface ReviewSubject {
  formType: FormType
  title: string
  fields: FormValues
}

export interface ReviewContext {
  ruleFindings: Finding[]
  guardFindings: Finding[]
  guard: GuardReport
  policies: PolicyChunk[]
  retrieval: string // 這次實際用了哪種檢索
  input: ReviewInput
}

export async function buildReviewContext(
  subject: ReviewSubject,
  options: {
    policies: readonly PolicyChunk[]
    guidelines: readonly Guideline[]
    now: Date
    retriever?: Retriever // 沒給就用 BM25
  },
): Promise<ReviewContext> {
  const { formType, title, fields } = subject
  const kind = getFormKind(formType)

  // 第一步：規則引擎
  const ruleFindings = runRules(formType, fields, options.now)

  // 第二步：輸入防護。規則引擎用的是原始資料（程式判斷不會被文字騙），
  // 送給 AI 的標題、欄位、說明則先移除疑似指令、遮罩個資
  // 檢索的查詢也用清理過的版本：用向量檢索時，查詢會送到外部的 embedding 服務
  // 每個文字欄位只處理一次（說明欄也是欄位之一），被移除的句子才不會重複計算
  const g = createGuard()
  const safeTitle = g.clean(title)
  const safeFields: FormValues = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, typeof value === 'string' ? g.clean(value) : value]),
  )
  const safeNarrative = safeFields[kind.narrativeField]
  const guard = g.report()

  // 第三步：檢索。查詢只用標題與填寫的文字，不用欄位名稱：
  // 每張報銷單都有「發票號碼」這個欄位，拿欄位名稱去查，每次都會查到發票的條文，真正相關的反而被擠掉
  const query = [safeTitle, ...Object.values(safeFields).filter((v) => typeof v === 'string')].join('\n')
  const { policies, retrieval } = await retrieve(options.policies, query, options.retriever ?? bm25Retriever, {
    topK: POLICY_TOP_K,
    // 一定要給的：核心條文，以及規則已經引用的條文（AI 才知道規則查到的問題依據是什麼）
    mustInclude: [...CORE_POLICIES[formType], ...ruleFindings.flatMap((f) => f.citations)],
  })

  // 第四步：審查準則。只給「這次有交給 AI 的條文」的準則，不相關的準則只會讓 AI 分心
  const given = new Set(policies.map((p) => p.id))
  const guidelines = options.guidelines
    .filter((g) => !g.retiredAt && given.has(g.policyId))
    .map(({ id, policyId, text }) => ({ id, policyId, text }))

  // 有人試圖影響 AI，這件事本身就要讓主管知道
  const guardFindings: Finding[] =
    guard.injections.length > 0
      ? [
          {
            kind: 'risk',
            source: 'guard',
            citations: [],
            message: `申請內容有 ${guard.injections.length} 段疑似要求 AI 改變判斷的文字，已在送給 AI 前移除，請主管留意：「${truncate(guard.injections[0]!)}」`,
          },
        ]
      : []

  return {
    ruleFindings,
    guardFindings,
    guard,
    policies,
    retrieval,
    input: {
      formType,
      formTitle: kind.def.title,
      title: safeTitle,
      values: fields,
      details: describeValues(kind.def, safeFields),
      narrative: typeof safeNarrative === 'string' ? safeNarrative : '',
      ruleFindings,
      guidelines,
      removedInjections: guard.injections.length,
    },
  }
}

const truncate = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max)}…` : s)

// 條文不多就全部給（也省下一次 embedding 呼叫）；檢索服務出錯時改用 BM25，預審不會因此失敗
async function retrieve(
  docs: readonly PolicyChunk[],
  query: string,
  retriever: Retriever,
  options: { topK: number; mustInclude: readonly string[] },
): Promise<{ policies: PolicyChunk[]; retrieval: string }> {
  if (docs.length <= options.topK) return { policies: [...docs], retrieval: 'all' }
  try {
    return { policies: pickRelevant(docs, await retriever.rank(docs, query), options), retrieval: retriever.name }
  } catch (err) {
    console.warn(`檢索（${retriever.name}）失敗，改用 BM25：`, err instanceof Error ? err.message : err)
    return { policies: pickRelevant(docs, await bm25Retriever.rank(docs, query), options), retrieval: 'bm25' }
  }
}
