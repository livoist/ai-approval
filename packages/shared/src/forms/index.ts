import type { FormDef, FormValues } from '../form'
import { runRuleSet, type Finding, type Rule } from '../rules'
import { EXPENSE_FORM, EXPENSE_RULES } from './expense'
import { MAINTENANCE_FORM, MAINTENANCE_RULES } from './maintenance'

// 申請單類型 = 表單定義 + 規則 + 對應的規範文件
// 系統的其他部分（狀態機、預審、串流、評價）完全不知道現在處理的是哪一種單，
// 只透過這裡拿到「這種單要怎麼填、怎麼檢查、依據哪份規範」
export interface FormKind {
  def: FormDef
  rules: Rule[]
  policyDocId: string // 對應後端的規範文件
  // AI 預審時，哪個欄位是「申請人自己寫的說明」，用來判斷寫得夠不夠具體
  narrativeField: string
}

export const FORM_KINDS = {
  maintenance: {
    def: MAINTENANCE_FORM,
    rules: MAINTENANCE_RULES,
    policyDocId: 'maintenance-sop',
    narrativeField: 'faultDescription',
  },
  expense: {
    def: EXPENSE_FORM,
    rules: EXPENSE_RULES,
    policyDocId: 'expense-policy',
    narrativeField: 'purpose',
  },
} satisfies Record<string, FormKind>
// satisfies：檢查每一項都符合 FormKind，但保留 'maintenance' | 'expense' 這兩個確切的 key
// 這樣 FormType 就是一個精確的型別，而不是籠統的 string

export type FormType = keyof typeof FORM_KINDS
export const FORM_TYPES = Object.keys(FORM_KINDS) as FormType[]

export function isFormType(x: unknown): x is FormType {
  return typeof x === 'string' && x in FORM_KINDS
}

export function getFormKind(type: FormType): FormKind {
  return FORM_KINDS[type]
}

export function runRules(type: FormType, values: FormValues, now = new Date()): Finding[] {
  return runRuleSet(FORM_KINDS[type].rules, values, { now })
}

// 這張單要不要多一關廠長：只要有一條「會升級」的規則成立就要
// 前端用它畫出簽核路線、後端用它決定主管核准後的下一步，兩邊算出來的一定一樣
export function needsPlantManager(type: FormType, values: FormValues, now = new Date()): boolean {
  return FORM_KINDS[type].rules.some((r) => r.escalatesToPlantManager && r.check(values, { now }) !== null)
}

export { EXPENSE_FORM, MAINTENANCE_FORM }
