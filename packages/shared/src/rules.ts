import type { FormValues } from './form'

// 預審意見：不論是規則引擎還是 AI 產生的，都是這個形狀
// source 讓主管一眼分得出來：「規則」是確定的，「AI」是建議
export interface Finding {
  kind: 'missing' | 'risk' | 'notice' | 'ok'
  message: string
  citations: string[] // 規範條文 id
  source: 'rule' | 'ai'
}

// 一條規則：對應一條規範條文，用程式判斷，結果 100% 可預期
interface Rule {
  id: string
  check(values: FormValues): Omit<Finding, 'source'> | null
}

const HIGH_VOLTAGE = 480
const PLANT_MANAGER_THRESHOLD = 500_000

const isHighVoltage = (v: FormValues) => typeof v.voltage === 'number' && v.voltage >= HIGH_VOLTAGE
const filled = (x: unknown) => x !== null && x !== undefined && x !== ''

// 規則引擎：明確、可以寫成 if 的規範，一律交給程式，不交給 AI
// 什麼時候「不該」用 AI，跟什麼時候該用一樣重要：
// 數字門檻、必附文件這類判斷，程式永遠不會看錯，AI 卻有可能
export const RULES: Rule[] = [
  {
    id: 'high-voltage-lockout-record',
    check: (v) =>
      isHighVoltage(v) && !(filled(v.lockoutBy) && filled(v.lockoutAt))
        ? {
            kind: 'missing',
            message: `額定電壓 ${v.voltage}V，須附斷電確認紀錄（執行人員與時間），未附者不得核准。`,
            citations: ['sop-4.2'],
          }
        : null,
  },
  {
    id: 'high-voltage-loto',
    check: (v) =>
      isHighVoltage(v) && v.lotoDone !== true
        ? { kind: 'risk', message: '高壓設備維修，尚未確認實施上鎖掛牌（LOTO）程序。', citations: ['sop-4.3'] }
        : null,
  },
  {
    id: 'plant-manager-approval',
    check: (v) =>
      typeof v.estimatedCost === 'number' && v.estimatedCost > PLANT_MANAGER_THRESHOLD
        ? {
            kind: 'notice',
            message: `預估費用 ${v.estimatedCost.toLocaleString('zh-TW')} 元，超過 50 萬元，須另經廠長核准。`,
            citations: ['sop-5.1'],
          }
        : null,
  },
]

export function runRules(values: FormValues): Finding[] {
  return RULES.flatMap((rule) => {
    const result = rule.check(values)
    return result ? [{ ...result, source: 'rule' as const }] : []
  })
}
