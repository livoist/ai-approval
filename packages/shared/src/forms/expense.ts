import type { FormDef } from '../form'
import { filled, money, num, type Rule } from '../rules'

// ===== 費用報銷申請單 =====
// 跟設備維修用的是同一套表單元件、同一個規則引擎、同一條簽核流程
// 新增這種申請單，沒有改到任何流程程式碼：只多了這一個檔案，加上一份規範文件
export const EXPENSE_FORM: FormDef = {
  id: 'expense',
  title: '費用報銷申請',
  sections: [
    {
      title: '費用資訊',
      fields: [
        {
          key: 'expenseType',
          label: '費用類別',
          type: 'select',
          required: true,
          options: ['交通費', '住宿費', '餐費', '業務招待費', '辦公用品', '其他'],
        },
        { key: 'amount', label: '金額', type: 'number', unit: '元', required: true, min: 0 },
        { key: 'expenseDate', label: '費用發生日期', type: 'date', required: true },
        {
          key: 'purpose',
          label: '報銷事由',
          type: 'textarea',
          required: true,
          minLength: 5,
          placeholder: '因什麼業務需要、在哪裡、跟誰……',
        },
      ],
    },
    {
      title: '住宿明細',
      showIf: { field: 'expenseType', equals: '住宿費' },
      fields: [{ key: 'nights', label: '住宿晚數', type: 'number', unit: '晚', required: true, min: 1 }],
    },
    {
      title: '招待對象',
      description: '業務招待費須載明招待對象與人數',
      showIf: { field: 'expenseType', equals: '業務招待費' },
      fields: [
        { key: 'guestCompany', label: '招待對象（公司）', type: 'text', placeholder: '例如：台灣精密股份有限公司' },
        { key: 'guestCount', label: '對方人數', type: 'number', unit: '人', min: 0 },
        { key: 'staffCount', label: '本公司人數', type: 'number', unit: '人', min: 0 },
      ],
    },
    {
      title: '憑證',
      fields: [
        // 大部分的費用都有發票，所以預設勾選；沒有的人才需要特別取消並說明原因
        { key: 'hasInvoice', label: '有統一發票或收據', type: 'boolean', defaultValue: true },
        {
          key: 'invoiceNumber',
          label: '發票號碼',
          type: 'text',
          required: true,
          placeholder: 'AB-12345678',
          pattern: '^[A-Z]{2}-?\\d{8}$',
          patternHint: '格式為兩個大寫英文字母加八位數字，例如 AB-12345678',
          showIf: { field: 'hasInvoice', equals: true },
        },
        {
          key: 'noInvoiceReason',
          label: '無法取得憑證的原因',
          type: 'textarea',
          showIf: { field: 'hasInvoice', equals: false },
        },
      ],
    },
  ],
}

const DEADLINE_DAYS = 60
const NO_INVOICE_LIMIT = 1_000
const LODGING_CAP_PER_NIGHT = 3_000
const ENTERTAINMENT_CAP_PER_PERSON = 2_000
const PLANT_MANAGER_THRESHOLD = 30_000
const DAY_MS = 24 * 60 * 60 * 1000

export const EXPENSE_RULES: Rule[] = [
  {
    id: 'plant-manager-approval',
    cites: ['fin-6.1'],
    escalatesToPlantManager: true,
    check: (v) => {
      const amount = num(v.amount)
      return amount !== null && amount > PLANT_MANAGER_THRESHOLD
        ? { kind: 'notice', message: `報銷金額 ${money(amount)}，超過 3 萬元，須另經廠長核准。` }
        : null
    },
  },
  {
    id: 'expense-deadline',
    cites: ['fin-2.1'],
    // 時間從 ctx.now 拿，不自己 new Date()，測試才能固定「今天」是哪一天
    check: (v, { now }) => {
      if (typeof v.expenseDate !== 'string') return null
      const days = Math.floor((now.getTime() - Date.parse(v.expenseDate)) / DAY_MS)
      return days > DEADLINE_DAYS
        ? { kind: 'risk', message: `費用發生至今已 ${days} 天，超過 ${DEADLINE_DAYS} 天的報銷期限。` }
        : null
    },
  },
  {
    id: 'no-invoice-reason',
    cites: ['fin-3.2'],
    check: (v) =>
      v.hasInvoice === false && !filled(v.noInvoiceReason)
        ? { kind: 'missing', message: '未檢附憑證，也未說明無法取得的原因。' }
        : null,
  },
  {
    id: 'no-invoice-limit',
    cites: ['fin-3.3'],
    check: (v) => {
      const amount = num(v.amount)
      return v.hasInvoice === false && amount !== null && amount > NO_INVOICE_LIMIT
        ? {
            kind: 'missing',
            message: `無憑證報銷單筆上限 ${money(NO_INVOICE_LIMIT)}，本次申請 ${money(amount)}。`,
          }
        : null
    },
  },
  {
    id: 'lodging-cap',
    cites: ['fin-4.2'],
    check: (v) => {
      const amount = num(v.amount)
      const nights = num(v.nights)
      if (v.expenseType !== '住宿費' || amount === null || !nights) return null
      const perNight = Math.round(amount / nights)
      return perNight > LODGING_CAP_PER_NIGHT
        ? {
            kind: 'risk',
            message: `每晚平均 ${money(perNight)}，超過每晚 ${money(LODGING_CAP_PER_NIGHT)} 的上限。`,
          }
        : null
    },
  },
  {
    id: 'entertainment-guests',
    cites: ['fin-5.2'],
    check: (v) =>
      v.expenseType === '業務招待費' && !(filled(v.guestCompany) && num(v.guestCount))
        ? { kind: 'missing', message: '業務招待費未載明招待對象公司與人數。' }
        : null,
  },
  {
    id: 'entertainment-per-person',
    cites: ['fin-5.1'],
    check: (v) => {
      const amount = num(v.amount)
      const people = (num(v.guestCount) ?? 0) + (num(v.staffCount) ?? 0)
      if (v.expenseType !== '業務招待費' || amount === null || people === 0) return null
      const perPerson = Math.round(amount / people)
      return perPerson > ENTERTAINMENT_CAP_PER_PERSON
        ? {
            kind: 'risk',
            message: `每人平均 ${money(perPerson)}（共 ${people} 人），超過每人 ${money(ENTERTAINMENT_CAP_PER_PERSON)} 的上限。`,
          }
        : null
    },
  },
]
