import type { FormType } from '@ai-approval/shared'
import { policiesFor, type PolicyChunk } from './policies'
import type { Retriever } from './retrieval'

// 檢索評估：檢索有沒有把「該給 AI 的條文」找出來
//
// 預審的評估集量的是 AI 判斷得對不對；這裡量的是更前面一步：AI 根本沒拿到的條文，它不可能引用
// 每一題是一段申請內容，加上「應該被找到的條文」，比較不同檢索方法的命中率
//
// 題目分兩種：
// - 用字相同（lexical）：申請內容裡直接出現規範的用字，BM25 的強項
// - 換句話說（paraphrase）：意思一樣但用字不同，例如「搭小黃」對「計程車」，向量檢索的強項
// 兩種都放，才看得出混合檢索是不是真的截長補短

// 範例 PDF「國內出差管理辦法」匯入後的條文（代碼 trv），讓題目涵蓋多份文件
export const TRAVEL_POLICY: PolicyChunk[] = [
  '本辦法適用於本公司員工因公務於國內出差之申請，以及交通、住宿與膳雜費用之報支。',
  '出差應事先填具出差申請，經部門主管核准後始得出發；因業務緊急而臨時出差者，應於返回後三個工作日內補辦申請。',
  '出差交通以大眾運輸工具為原則，搭乘高鐵以標準車廂為限。因業務急迫或攜帶設備而需搭乘計程車者，應於報銷事由中說明原因。',
  '自行開車出差者，油資依實際里程每公里新台幣 3 元計算；停車費與過路費應檢附單據核實報支。',
  '出差地點距離公司 60 公里以上，或當日工作結束時間晚於晚上九點者，始得申請住宿。',
  '住宿應優先選擇公司特約飯店；特約飯店客滿時得自行選擇，惟仍依費用報銷作業辦法之每晚上限計算。',
  '出差期間每日膳雜費為新台幣 400 元；主辦單位或客戶已提供餐點者，應扣除該餐之費用。',
  '出差返回後應於 30 日內檢附單據辦理報銷，並於報銷事由中註明出差申請單號；逾期者依費用報銷作業辦法辦理。',
].map((text, i) => ({ id: `trv-${i + 1}`, docId: 'trv', docTitle: '國內出差管理辦法', section: String(i + 1), text }))

export interface RetrievalCase {
  id: string
  formType: FormType
  query: string
  relevant: string[] // 應該被找到的條文
  type: 'lexical' | 'paraphrase'
}

export const RETRIEVAL_CASES: RetrievalCase[] = [
  // ===== 用字相同 =====
  { id: 'lx-hsr', formType: 'expense', query: '台北新竹往返高鐵票', relevant: ['trv-3'], type: 'lexical' },
  { id: 'lx-lodging', formType: 'expense', query: '出差住宿三晚，每晚 4,000 元', relevant: ['fin-4.2'], type: 'lexical' },
  { id: 'lx-invoice', formType: 'expense', query: '臨時工無法取得憑證，沒有發票', relevant: ['fin-3.2'], type: 'lexical' },
  { id: 'lx-guest', formType: 'expense', query: '招待客戶四人，每人平均 3,000 元', relevant: ['fin-5.1'], type: 'lexical' },
  { id: 'lx-car', formType: 'expense', query: '自行開車去台中，油資與停車費', relevant: ['trv-4'], type: 'lexical' },
  { id: 'lx-hv', formType: 'maintenance', query: '480V 高壓設備維修前的斷電作業', relevant: ['sop-4.1'], type: 'lexical' },
  { id: 'lx-cost', formType: 'maintenance', query: '預估維修費用 80 萬元', relevant: ['sop-5.1'], type: 'lexical' },
  { id: 'lx-hotel', formType: 'expense', query: '特約飯店客滿，改住附近的商務旅館', relevant: ['trv-6'], type: 'lexical' },
  // ===== 換句話說 =====
  { id: 'pp-taxi', formType: 'expense', query: '搭小黃去客戶工廠', relevant: ['trv-3'], type: 'paraphrase' },
  { id: 'pp-late', formType: 'expense', query: '東西是兩個多月前買的，現在才請款', relevant: ['fin-2.1'], type: 'paraphrase' },
  { id: 'pp-meals', formType: 'expense', query: '外地工作那幾天的三餐補助', relevant: ['trv-7'], type: 'paraphrase' },
  { id: 'pp-overnight', formType: 'expense', query: '十點才收工，想在當地過夜', relevant: ['trv-5'], type: 'paraphrase' },
  { id: 'pp-company', formType: 'expense', query: '請客人吃飯，沒寫是哪一家廠商', relevant: ['fin-5.2'], type: 'paraphrase' },
  { id: 'pp-30k', formType: 'expense', query: '這筆花了三萬五，誰要簽', relevant: ['fin-6.1'], type: 'paraphrase' },
  { id: 'pp-when', formType: 'maintenance', query: '機器壞掉多久了也要寫嗎', relevant: ['sop-3.2'], type: 'paraphrase' },
  { id: 'pp-lock', formType: 'maintenance', query: '動手修之前要先把開關鎖住、掛警示牌', relevant: ['sop-4.3'], type: 'paraphrase' },
]

export interface RetrievalCaseResult {
  caseId: string
  rank: number | null // 第一條相關條文排第幾名（從 1 開始）；沒找到是 null
  hit: boolean // 有沒有出現在前 k 名
}

export interface RetrievalMetrics {
  recall: number // 前 k 名找到相關條文的比例
  mrr: number // 平均倒數名次：第 1 名得 1 分、第 2 名 0.5 分…，越前面越好
}

export interface RetrievalReport {
  method: string
  k: number
  overall: RetrievalMetrics
  byType: Record<RetrievalCase['type'], RetrievalMetrics>
  results: RetrievalCaseResult[]
}

// 每一題的候選條文：這種申請單的內建規範，報銷單再加上出差辦法
export function corpusFor(type: FormType): PolicyChunk[] {
  return type === 'expense' ? [...policiesFor(type), ...TRAVEL_POLICY] : policiesFor(type)
}

function metrics(results: RetrievalCaseResult[]): RetrievalMetrics {
  if (results.length === 0) return { recall: 0, mrr: 0 }
  return {
    recall: results.filter((r) => r.hit).length / results.length,
    mrr: results.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / results.length,
  }
}

export async function evaluateRetrieval(
  retriever: Retriever,
  options: { k?: number; cases?: RetrievalCase[] } = {},
): Promise<RetrievalReport> {
  const k = options.k ?? 3
  const cases = options.cases ?? RETRIEVAL_CASES
  const results: RetrievalCaseResult[] = []
  for (const c of cases) {
    const ranked = await retriever.rank(corpusFor(c.formType), c.query)
    const index = ranked.findIndex((r) => c.relevant.includes(r.id))
    const rank = index === -1 ? null : index + 1
    results.push({ caseId: c.id, rank, hit: rank !== null && rank <= k })
  }
  const of = (type: RetrievalCase['type']) => results.filter((_, i) => cases[i]!.type === type)
  return {
    method: retriever.name,
    k,
    overall: metrics(results),
    byType: { lexical: metrics(of('lexical')), paraphrase: metrics(of('paraphrase')) },
    results,
  }
}
