import { describeValues, getFormKind, runRules, type Finding, type FormType, type FormValues } from '@ai-approval/shared'
import { CORE_POLICIES, type PolicyChunk } from './policies'
import { selectRelevant } from './retrieval'
import type { ReviewInput } from './reviewer'
import type { Guideline } from './store'

// 預審前的準備：規則引擎 → 檢索規範 → 挑出相關的審查準則 → 組成交給 AI 的輸入
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

export function buildReviewContext(
  subject: ReviewSubject,
  options: { policies: readonly PolicyChunk[]; guidelines: readonly Guideline[]; now: Date },
): { ruleFindings: Finding[]; policies: PolicyChunk[]; input: ReviewInput } {
  const { formType, title, fields } = subject
  const kind = getFormKind(formType)
  const narrative = fields[kind.narrativeField]

  // 第一步：規則引擎
  const ruleFindings = runRules(formType, fields, options.now)

  // 第二步：檢索。查詢只用標題與填寫的文字，不用欄位名稱：
  // 每張報銷單都有「發票號碼」這個欄位，拿欄位名稱去查，每次都會查到發票的條文，真正相關的反而被擠掉
  const query = [title, ...Object.values(fields).filter((v) => typeof v === 'string')].join('\n')
  const policies = selectRelevant(options.policies, query, {
    topK: POLICY_TOP_K,
    // 一定要給的：核心條文，以及規則已經引用的條文（AI 才知道規則查到的問題依據是什麼）
    mustInclude: [...CORE_POLICIES[formType], ...ruleFindings.flatMap((f) => f.citations)],
  })

  // 第三步：審查準則。只給「這次有交給 AI 的條文」的準則，不相關的準則只會讓 AI 分心
  const given = new Set(policies.map((p) => p.id))
  const guidelines = options.guidelines
    .filter((g) => !g.retiredAt && given.has(g.policyId))
    .map(({ id, policyId, text }) => ({ id, policyId, text }))

  return {
    ruleFindings,
    policies,
    input: {
      formType,
      formTitle: kind.def.title,
      title,
      values: fields,
      details: describeValues(kind.def, fields),
      narrative: typeof narrative === 'string' ? narrative : '',
      ruleFindings,
      guidelines,
    },
  }
}
