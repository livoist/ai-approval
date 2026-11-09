import { describe, expect, it } from 'vitest'
import { validateValues, visibleFields } from '../form'
import { EXPENSE_FORM as form, runRules } from './index'

// 固定「今天」：期限類的規則才測得出一致的結果
const today = new Date('2026-11-04T12:00:00+08:00')
const run = (v: Record<string, string | number | boolean | null>) => runRules('expense', v, today)

const base = {
  expenseType: '交通費',
  amount: 1250,
  expenseDate: '2026-10-28',
  purpose: '前往新竹客戶端進行設備驗收，往返高鐵票',
  hasInvoice: true,
  invoiceNumber: 'AB-12345678',
}

describe('費用報銷表單', () => {
  it('資料完整時沒有錯誤、也沒有規則意見', () => {
    expect(validateValues(form, base)).toEqual({})
    expect(run(base)).toEqual([])
  })

  it('選住宿費才出現住宿晚數，選業務招待費才出現招待對象', () => {
    const keys = (v: typeof base) => visibleFields(form, v).map((f) => f.key)
    expect(keys(base).includes('nights')).toBe(false)
    expect(keys({ ...base, expenseType: '住宿費' }).includes('nights')).toBe(true)
    expect(keys({ ...base, expenseType: '業務招待費' }).includes('guestCompany')).toBe(true)
  })

  it('有發票就必須填發票號碼，格式也要對', () => {
    expect(validateValues(form, { ...base, invoiceNumber: '' }).invoiceNumber).toBe('請填寫發票號碼')
    expect(validateValues(form, { ...base, invoiceNumber: '12345' }).invoiceNumber).toMatch('格式')
  })
})

describe('費用報銷規則', () => {
  it('超過 60 天才報銷', () => {
    expect(run({ ...base, expenseDate: '2026-08-01' })[0]).toMatchObject({ kind: 'risk', citations: ['fin-2.1'] })
    expect(run({ ...base, expenseDate: '2026-09-10' })).toEqual([]) // 55 天，還在期限內
  })

  it('沒有發票：沒寫原因 → 缺漏；超過 1,000 元 → 缺漏', () => {
    const noInvoice = { ...base, hasInvoice: false, invoiceNumber: null, amount: 800 }
    expect(run(noInvoice).map((f) => f.citations[0])).toEqual(['fin-3.2'])
    expect(run({ ...noInvoice, noInvoiceReason: '計程車司機無法開立收據' })).toEqual([])
    expect(run({ ...noInvoice, noInvoiceReason: '遺失', amount: 1500 }).map((f) => f.citations[0])).toEqual([
      'fin-3.3',
    ])
  })

  it('住宿每晚超過 3,000 元', () => {
    const lodging = { ...base, expenseType: '住宿費', amount: 7000, nights: 2 }
    expect(run(lodging)[0]?.message).toMatch('3,500')
    expect(run({ ...lodging, amount: 6000 })).toEqual([])
  })

  it('業務招待：沒寫對象 → 缺漏；每人超過 2,000 元 → 風險', () => {
    const treat = { ...base, expenseType: '業務招待費', amount: 9000 }
    expect(run(treat).map((f) => f.citations[0])).toEqual(['fin-5.2'])

    const withGuests = { ...treat, guestCompany: '台灣精密', guestCount: 2, staffCount: 2 }
    expect(run(withGuests).map((f) => f.citations[0])).toEqual(['fin-5.1']) // 每人 2,250
    expect(run({ ...withGuests, amount: 8000 })).toEqual([]) // 每人剛好 2,000
  })
})

describe('簽核路線', () => {
  it('報銷超過 3 萬元要部門主管核准，剛好 3 萬不用', async () => {
    const { needsPlantManager } = await import('./index')
    expect(needsPlantManager('expense', { ...base, amount: 30_001 }, today)).toBe(true)
    expect(needsPlantManager('expense', { ...base, amount: 30_000 }, today)).toBe(false)
    expect(run({ ...base, amount: 30_001 })[0]).toMatchObject({ kind: 'notice', citations: ['fin-6.1'] })
  })

  it('設備維修超過 50 萬要部門主管核准', async () => {
    const { needsPlantManager } = await import('./index')
    expect(needsPlantManager('maintenance', { estimatedCost: 500_001 })).toBe(true)
    expect(needsPlantManager('maintenance', { estimatedCost: 500_000 })).toBe(false)
  })
})
