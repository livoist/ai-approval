import type { FormValues } from './form'

// 預審意見：不論是規則引擎還是 AI 產生的，都是這個形狀
// source 讓主管一眼分得出來：「規則」是確定的，「AI」是建議
export interface Finding {
  kind: 'missing' | 'risk' | 'notice' | 'ok'
  message: string
  citations: string[] // 規範條文 id
  source: 'rule' | 'ai'
}

// 規則執行時可以用到的外部資訊
// 時間從外面傳進來，而不是在規則裡呼叫 new Date()：
// 這樣「超過 60 天」這種規則才測得了，測試可以指定任何一天當作「今天」
export interface RuleContext {
  now: Date
}

// 一條規則：對應固定的規範條文，用程式判斷，結果 100% 可預期
// cites 寫在規則上而不是寫在判斷結果裡：每條規則引用哪些條文一目了然，也方便測試檢查
export interface Rule {
  id: string
  cites: string[]
  // 這條規則成立時，簽核要多一關廠長：規範不只是被引用，而是真的改變流程走向
  escalatesToPlantManager?: boolean
  check(values: FormValues, ctx: RuleContext): Pick<Finding, 'kind' | 'message'> | null
}

// 規則引擎：明確、可以寫成 if 的規範，一律交給程式，不交給 AI
// 什麼時候「不該」用 AI，跟什麼時候該用一樣重要：
// 數字門檻、必附文件這類判斷，程式永遠不會看錯，AI 卻有可能
export function runRuleSet(rules: Rule[], values: FormValues, ctx: RuleContext): Finding[] {
  return rules.flatMap((rule) => {
    const result = rule.check(values, ctx)
    return result ? [{ ...result, citations: rule.cites, source: 'rule' as const }] : []
  })
}

// 規則常用的小工具
export const filled = (x: unknown) => x !== null && x !== undefined && x !== ''
export const num = (x: unknown) => (typeof x === 'number' && !Number.isNaN(x) ? x : null)
export const money = (n: number) => `${n.toLocaleString('zh-TW')} 元`
