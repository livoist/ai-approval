import { getFormKind, isFormType, type Finding, type FormType } from '@ai-approval/shared'
import { createPolicyLibrary } from './policies'
import type { FindingFeedback, Store } from './store'

// AI 準確度統計：把主管的評價整理成「AI 哪裡做得好、哪裡常出錯」
//
// 這裡只做計算，不碰 HTTP，也不管畫面怎麼畫
// 輸入是 store 裡的原始紀錄，輸出是一包已經算好的數字，前端拿到就能直接畫圖

// 一組 AI 意見的評價分布；「未評價」= total - correct - incorrect
export interface VerdictCounts {
  total: number
  correct: number
  incorrect: number
}

export interface AiStats {
  totals: { reviews: number; ruleFindings: number; aiFindings: VerdictCounts }
  daily: ({ date: string } & VerdictCounts)[]
  byPolicy: ({ policyId: string | null; docTitle: string; section: string; text: string } & VerdictCounts)[]
  byFormType: { formType: string; title: string; ruleFindings: number; aiFindings: VerdictCounts }[]
  byReviewer: ({ reviewer: string } & VerdictCounts)[]
  recentIncorrect: {
    requestId: string
    title: string
    formType: string
    message: string
    citations: string[]
    note: string
    actorId: string
    at: string
  }[]
}

const empty = (): VerdictCounts => ({ total: 0, correct: 0, incorrect: 0 })

function add(counts: VerdictCounts, feedback: FindingFeedback | undefined) {
  counts.total++
  if (feedback) counts[feedback.verdict]++
}

// 依台北時間分日：伺服器在國外（Render 新加坡）也一樣，不會把晚上 11 點的單算到隔天
const taipeiDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

// Map 裡沒有就建一個新的，有就沿用：分組統計時每次都要寫的那幾行
function bucket<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let v = map.get(key)
  if (!v) map.set(key, (v = create()))
  return v
}

export function computeAiStats(store: Store, options: { now?: Date; days?: number } = {}): AiStats {
  const now = options.now ?? new Date()
  const days = options.days ?? 14

  // 趨勢圖的每一天都要有，沒有資料的日子是 0，不能直接跳過，不然折線會騙人
  const daily = new Map<string, VerdictCounts>()
  for (let i = days - 1; i >= 0; i--) {
    daily.set(taipeiDate(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)), empty())
  }

  const totals = { reviews: 0, ruleFindings: 0, aiFindings: empty() }
  const byPolicy = new Map<string | null, VerdictCounts>()
  const byFormType = new Map<string, { ruleFindings: number; aiFindings: VerdictCounts }>()
  const byReviewer = new Map<string, VerdictCounts>()
  const incorrect: AiStats['recentIncorrect'] = []

  for (const request of store.listRequests()) {
    // 補件重送前的舊版本預審也算：那是 AI 當時真的說過的話，主管也可能評價過
    for (const review of store.listReviews(request.id)) {
      if (review.status !== 'done') continue
      totals.reviews++

      // 同一條意見被評價過好幾次（改主意）時，以最後一次為準
      const latest = new Map<number, FindingFeedback>()
      for (const f of store.listFeedback(review.id)) latest.set(f.findingIndex, f)

      const form = bucket(byFormType, request.formType, () => ({ ruleFindings: 0, aiFindings: empty() }))
      const day = daily.get(taipeiDate(new Date(review.createdAt)))
      // 「mock（今日額度已用完）」這種備援紀錄，歸到實際審查的 mock
      const reviewer = bucket(byReviewer, review.reviewer.split('（')[0]!, empty)

      ;(review.findings ?? []).forEach((finding: Finding, index) => {
        // 規則的意見是程式判斷的，沒有「對錯」可言，只算數量
        if (finding.source === 'rule') {
          totals.ruleFindings++
          form.ruleFindings++
          return
        }

        const feedback = latest.get(index)
        add(totals.aiFindings, feedback)
        add(form.aiFindings, feedback)
        add(reviewer, feedback)
        if (day) add(day, feedback) // 超出統計天數的舊資料不畫在趨勢圖上，但總數照算

        // 一條意見引用兩條條文，兩條各算一次；沒有引用的歸在 null
        const cited = finding.citations.length > 0 ? finding.citations : [null]
        for (const id of cited) add(bucket(byPolicy, id, empty), feedback)

        if (feedback?.verdict === 'incorrect') {
          incorrect.push({
            requestId: request.id,
            title: request.title,
            formType: request.formType,
            message: finding.message,
            citations: finding.citations,
            note: feedback.note,
            actorId: feedback.actorId,
            at: feedback.createdAt,
          })
        }
      })
    }
  }

  // 內建的與匯入的條文都要查得到，AI 可能引用了主管後來匯入的規範
  const policyInfo = new Map(createPolicyLibrary(store).all().map((p) => [p.id, p]))

  return {
    totals,
    daily: [...daily].map(([date, counts]) => ({ date, ...counts })),
    // 最常被標記有誤的條文排最前面：這就是下一步要改 prompt 的地方
    byPolicy: [...byPolicy]
      .map(([policyId, counts]) => {
        const p = policyId ? policyInfo.get(policyId) : undefined
        return {
          policyId,
          docTitle: p?.docTitle ?? '',
          section: p?.section ?? '',
          text: p?.text ?? '沒有引用條文',
          ...counts,
        }
      })
      .sort((a, b) => b.incorrect - a.incorrect || b.total - a.total),
    byFormType: [...byFormType].map(([formType, counts]) => ({
      formType,
      title: isFormType(formType) ? getFormKind(formType as FormType).def.title : formType,
      ...counts,
    })),
    byReviewer: [...byReviewer]
      .map(([reviewer, counts]) => ({ reviewer, ...counts }))
      .sort((a, b) => b.total - a.total),
    recentIncorrect: incorrect.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10),
  }
}
