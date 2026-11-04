// 表單定義：用「資料」描述表單長什麼樣子，而不是把欄位寫死在 Vue 元件裡
//
// 好處：
// 1. 前端照著定義畫出表單，後端照著同一份定義驗證，規則永遠一致
// 2. 要新增一種申請單，只要多寫一份定義，不用寫新的頁面（見 forms/ 資料夾）
// 3. 定義本身可以存進資料庫，讓管理者自己調整欄位（之後的延伸方向）

export type FieldValue = string | number | boolean | null
export type FormValues = Record<string, FieldValue>

// 顯示條件：只有在某個欄位符合條件時才顯示
// 寫成資料而不是函式，這樣定義才能序列化成 JSON
export type Condition = { field: string; equals: FieldValue } | { field: string; gte: number }

interface BaseField {
  key: string
  label: string
  help?: string
  required?: boolean
  showIf?: Condition
  defaultValue?: FieldValue // 開新表單時的預設值
}

export type FieldDef =
  | (BaseField & { type: 'text'; placeholder?: string; pattern?: string; patternHint?: string })
  | (BaseField & { type: 'textarea'; placeholder?: string; minLength?: number })
  | (BaseField & { type: 'number'; unit?: string; min?: number })
  | (BaseField & { type: 'select'; options: string[] })
  | (BaseField & { type: 'boolean' })
  | (BaseField & { type: 'datetime' })
  | (BaseField & { type: 'date' })

export interface FormSection {
  title: string
  description?: string
  showIf?: Condition
  fields: FieldDef[]
}

export interface FormDef {
  id: string
  title: string
  sections: FormSection[]
}

// ===== 表單工具函式（前後端共用）=====

const isEmpty = (v: FieldValue | undefined) => v === null || v === undefined || v === ''

export function matches(condition: Condition | undefined, values: FormValues) {
  if (!condition) return true
  const v = values[condition.field]
  if ('equals' in condition) return v === condition.equals
  return typeof v === 'number' && v >= condition.gte
}

// 新表單的初始值：有寫 defaultValue 的用它；勾選框沒寫的一律預設不勾
// 「沒勾」跟「沒填」意義不同，所以勾選框要有明確的 false，而不是留空
export function defaultValues(def: FormDef): FormValues {
  const values: FormValues = {}
  for (const f of def.sections.flatMap((s) => s.fields)) {
    if (f.defaultValue !== undefined) values[f.key] = f.defaultValue
    else if (f.type === 'boolean') values[f.key] = false
  }
  return values
}

// 依目前填寫的內容，算出「現在看得到」的欄位
export function visibleFields(def: FormDef, values: FormValues): FieldDef[] {
  return def.sections
    .filter((s) => matches(s.showIf, values))
    .flatMap((s) => s.fields.filter((f) => matches(f.showIf, values)))
}

// 只保留看得到的欄位：例如把停機改成否，原本填的停機時間就該丟掉，不能偷偷存進資料庫
export function normalizeValues(def: FormDef, values: FormValues): FormValues {
  const result: FormValues = {}
  for (const f of visibleFields(def, values)) {
    const v = values[f.key]
    result[f.key] = isEmpty(v) ? null : (v as FieldValue)
  }
  return result
}

// 驗證：回傳「欄位 → 錯誤訊息」，空物件代表通過
// 前端用它即時顯示紅字，後端用它拒絕不合法的請求，兩邊的規則一模一樣
export function validateValues(def: FormDef, values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const f of visibleFields(def, values)) {
    const v = values[f.key]

    if (isEmpty(v)) {
      if (f.required) errors[f.key] = `請填寫${f.label}`
      continue
    }

    switch (f.type) {
      case 'text':
        if (typeof v !== 'string') errors[f.key] = `${f.label}格式不正確`
        else if (f.pattern && !new RegExp(f.pattern).test(v))
          errors[f.key] = f.patternHint ?? `${f.label}格式不正確`
        break
      case 'textarea':
        if (typeof v !== 'string') errors[f.key] = `${f.label}格式不正確`
        else if (f.minLength && v.trim().length < f.minLength)
          errors[f.key] = `${f.label}至少需要 ${f.minLength} 個字`
        break
      case 'number':
        if (typeof v !== 'number' || Number.isNaN(v)) errors[f.key] = `${f.label}必須是數字`
        else if (f.min !== undefined && v < f.min) errors[f.key] = `${f.label}不能小於 ${f.min}`
        break
      case 'select':
        if (typeof v !== 'string' || !f.options.includes(v)) errors[f.key] = `請選擇${f.label}`
        break
      case 'boolean':
        if (typeof v !== 'boolean') errors[f.key] = `${f.label}格式不正確`
        break
      case 'datetime':
      case 'date':
        if (typeof v !== 'string' || Number.isNaN(Date.parse(v)))
          errors[f.key] = `${f.label}格式不正確`
        break
    }
  }

  return errors
}

// 把填寫內容轉成「標籤：值」，給畫面顯示、也給 AI 閱讀
export function describeValues(def: FormDef, values: FormValues): { label: string; value: string }[] {
  return visibleFields(def, values).map((f) => {
    const v = values[f.key]
    let value: string
    if (isEmpty(v)) value = '（未填寫）'
    else if (f.type === 'boolean') value = v ? '是' : '否'
    else if (f.type === 'number') value = `${Number(v).toLocaleString('zh-TW')}${f.unit ? ` ${f.unit}` : ''}`
    else if (f.type === 'datetime') value = String(v).replace('T', ' ')
    else value = String(v)
    return { label: f.label, value }
  })
}
