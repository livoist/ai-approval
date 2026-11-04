import { describe, expect, it } from 'vitest'
import { defaultValues, normalizeValues, validateValues, visibleFields } from './form'
import { EXPENSE_FORM, MAINTENANCE_FORM as form, runRules as runFormRules } from './forms'

const runRules = (values: Parameters<typeof runFormRules>[1]) => runFormRules('maintenance', values)

const base = {
  equipmentId: 'HV-0207',
  area: 'A 廠區',
  voltage: 220,
  estimatedCost: 30000,
  faultDescription: '馬達運轉時有異音',
  isDown: false,
}

describe('表單顯示條件', () => {
  it('低壓設備不顯示高壓作業欄位', () => {
    const keys = visibleFields(form, base).map((f) => f.key)
    expect(keys.includes('lockoutBy')).toBe(false)
  })

  it('480V 以上顯示高壓作業欄位', () => {
    const keys = visibleFields(form, { ...base, voltage: 480 }).map((f) => f.key)
    expect(keys.includes('lockoutBy')).toBe(true)
  })

  it('停機才顯示停機時間', () => {
    expect(visibleFields(form, base).some((f) => f.key === 'downSince')).toBe(false)
    expect(visibleFields(form, { ...base, isDown: true }).some((f) => f.key === 'downSince')).toBe(true)
  })

  it('隱藏欄位的值會被丟掉', () => {
    const v = normalizeValues(form, { ...base, isDown: false, downSince: '2026-11-04T08:00' })
    expect('downSince' in v).toBe(false)
  })
})

describe('表單驗證', () => {
  it('完整填寫時沒有錯誤', () => {
    expect(validateValues(form, base)).toEqual({})
  })

  it('必填欄位沒填', () => {
    expect(validateValues(form, { ...base, equipmentId: '' })).toEqual({ equipmentId: '請填寫設備編號' })
  })

  it('設備編號格式錯誤', () => {
    expect(validateValues(form, { ...base, equipmentId: 'hv207' }).equipmentId).toMatch('格式')
  })

  it('停機了就必須填停機時間', () => {
    expect(validateValues(form, { ...base, isDown: true })).toEqual({ downSince: '請填寫停機起始時間' })
  })

  it('高壓作業欄位不是必填：缺了交給規則引擎標記，不擋送出', () => {
    expect(validateValues(form, { ...base, voltage: 480 })).toEqual({})
  })

  it('下拉選單只能選定義裡的選項', () => {
    expect(validateValues(form, { ...base, area: 'Z 廠區' }).area).toBe('請選擇所在廠區')
  })
})

describe('規則引擎', () => {
  it('低壓、低費用：沒有任何意見', () => {
    expect(runRules(base)).toEqual([])
  })

  it('高壓且沒有斷電紀錄與 LOTO', () => {
    expect(runRules({ ...base, voltage: 480 }).map((f) => f.citations[0])).toEqual(['sop-4.2', 'sop-4.3'])
  })

  it('高壓但資料齊全', () => {
    const v = { ...base, voltage: 480, lockoutBy: '陳工程師', lockoutAt: '2026-11-04T09:00', lotoDone: true }
    expect(runRules(v)).toEqual([])
  })

  it('只填了斷電人員、沒填時間，仍然算缺漏', () => {
    expect(runRules({ ...base, voltage: 480, lockoutBy: '陳工程師', lotoDone: true })).toHaveLength(1)
  })

  it('超過 50 萬要廠長核准，剛好 50 萬不用', () => {
    expect(runRules({ ...base, estimatedCost: 500_001 })[0]?.kind).toBe('notice')
    expect(runRules({ ...base, estimatedCost: 500_000 })).toEqual([])
  })

  it('規則產生的意見都標示來源為 rule', () => {
    expect(runRules({ ...base, voltage: 480 }).every((f) => f.source === 'rule')).toBe(true)
  })
})

describe('預設值', () => {
  it('勾選框沒寫預設值就是 false；有寫 defaultValue 的用它', () => {
    expect(defaultValues(form)).toEqual({ isDown: false, lotoDone: false })
    expect(defaultValues(EXPENSE_FORM)).toEqual({ hasInvoice: true })
  })
})
