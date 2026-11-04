// 表單定義：用「資料」描述表單長什麼樣子，而不是把欄位寫死在 Vue 元件裡
//
// 好處：
// 1. 前端照著定義畫出表單，後端照著同一份定義驗證，規則永遠一致
// 2. 要新增一種申請單（例如費用申請），只要多寫一份定義，不用寫新的頁面
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
}

export type FieldDef =
  | (BaseField & { type: 'text'; placeholder?: string; pattern?: string; patternHint?: string })
  | (BaseField & { type: 'textarea'; placeholder?: string; minLength?: number })
  | (BaseField & { type: 'number'; unit?: string; min?: number })
  | (BaseField & { type: 'select'; options: string[] })
  | (BaseField & { type: 'boolean' })
  | (BaseField & { type: 'datetime' })

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

// ===== 設備維修申請單 =====
// 注意「高壓作業」區塊的欄位都不是必填：
// 表單只擋「格式錯誤」，規範要求的東西沒填，交給規則引擎標記出來（見 rules.ts）
// 這樣申請人緊急時還是可以先送出，主管會在預審結果裡清楚看到缺了什麼
export const MAINTENANCE_FORM: FormDef = {
  id: 'maintenance',
  title: '設備維修申請',
  sections: [
    {
      title: '設備資訊',
      fields: [
        {
          key: 'equipmentId',
          label: '設備編號',
          type: 'text',
          required: true,
          placeholder: 'HV-0207',
          pattern: '^[A-Z]{2}-\\d{4}$',
          patternHint: '格式為兩個大寫英文字母、一個連字號、四位數字，例如 HV-0207',
        },
        {
          key: 'area',
          label: '所在廠區',
          type: 'select',
          required: true,
          options: ['A 廠區', 'B 廠區', 'C 廠區'],
        },
        { key: 'voltage', label: '額定電壓', type: 'number', unit: 'V', required: true, min: 0 },
        { key: 'estimatedCost', label: '預估費用', type: 'number', unit: '元', required: true, min: 0 },
      ],
    },
    {
      title: '故障狀況',
      fields: [
        {
          key: 'faultDescription',
          label: '故障說明',
          type: 'textarea',
          required: true,
          minLength: 5,
          placeholder: '發生什麼現象、什麼時候開始、目前影響範圍……',
        },
        { key: 'isDown', label: '設備已停機', type: 'boolean' },
        {
          key: 'downSince',
          label: '停機起始時間',
          type: 'datetime',
          required: true,
          showIf: { field: 'isDown', equals: true },
        },
      ],
    },
    {
      title: '高壓作業安全',
      description: '額定電壓 480V 以上的設備須填寫',
      showIf: { field: 'voltage', gte: 480 },
      fields: [
        { key: 'lockoutBy', label: '斷電執行人員', type: 'text', placeholder: '例如：電氣課 陳工程師' },
        { key: 'lockoutAt', label: '斷電完成時間', type: 'datetime' },
        { key: 'lotoDone', label: '作業區域已實施上鎖掛牌（LOTO）', type: 'boolean' },
      ],
    },
  ],
}

// ===== 表單工具函式（前後端共用）=====

const isEmpty = (v: FieldValue | undefined) => v === null || v === undefined || v === ''

export function matches(condition: Condition | undefined, values: FormValues) {
  if (!condition) return true
  const v = values[condition.field]
  if ('equals' in condition) return v === condition.equals
  return typeof v === 'number' && v >= condition.gte
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
