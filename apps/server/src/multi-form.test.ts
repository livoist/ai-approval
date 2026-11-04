import { beforeEach, describe, expect, it } from 'vitest'
import { COMPLETE_EXPENSE, COMPLETE_LOW_VOLTAGE, alice, manager, mustCreate } from './fixtures'
import { createRequestService, type RequestService } from './request-service'
import { mockReviewer } from './reviewer'
import { createStore } from './store'

// 泛化的證明：同一個 service、同一條流程，處理兩種完全不同的申請單
let service: RequestService

beforeEach(() => {
  service = createRequestService(createStore(), mockReviewer)
})

async function submitAndReview(id: string) {
  service.sendEvent(id, 'SUBMIT', alice)
  await service.waitForReview(id)
  return service.getLatestReview(id)!
}

describe('多種申請單', () => {
  it('不存在的申請單類型 → unknown_form_type', () => {
    expect(
      service.createRequest(alice, { formType: 'vacation', title: '請假', fields: {} }),
    ).toEqual({ ok: false, reason: 'unknown_form_type' })
  })

  it('用報銷單的欄位驗證報銷單：缺事由、發票號碼格式錯誤', () => {
    const result = service.createRequest(alice, {
      formType: 'expense',
      title: '高鐵票',
      fields: { ...COMPLETE_EXPENSE, purpose: '', invoiceNumber: '123' },
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_fields' })
    if (!result.ok && result.reason === 'invalid_fields') {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(['invoiceNumber', 'purpose'])
    }
  })

  it('資料完整的報銷單：沒有任何意見，走完核准流程', async () => {
    const r = mustCreate(service, alice, COMPLETE_EXPENSE, '高鐵票', 'expense')
    expect(r.formType).toBe('expense')
    expect(await submitAndReview(r.id)).toMatchObject({ riskLevel: 'low', findings: [] })
    expect(service.sendEvent(r.id, 'APPROVE', manager)).toMatchObject({ ok: true })
  })

  it('報銷單有自己的規則與規範：招待超標 + 事由籠統', async () => {
    const r = mustCreate(
      service,
      alice,
      {
        ...COMPLETE_EXPENSE,
        expenseType: '業務招待費',
        amount: 12000,
        purpose: '客戶聚餐討論',
        guestCompany: '台灣精密',
        guestCount: 2,
        staffCount: 2,
      },
      '客戶餐敘',
      'expense',
    )
    const review = await submitAndReview(r.id)
    expect(review.findings?.map((f) => `${f.source}:${f.citations[0]}`)).toEqual([
      'rule:fin-5.1', // 每人 3,000 元，超過上限
      'ai:fin-2.2', // 事由太短
    ])
  })

  it('設備維修單的規則不會套到報銷單上，反之亦然', async () => {
    const expense = mustCreate(service, alice, COMPLETE_EXPENSE, '高鐵票', 'expense')
    const maintenance = mustCreate(service, alice, COMPLETE_LOW_VOLTAGE)
    const cites = async (id: string) => (await submitAndReview(id)).findings?.flatMap((f) => f.citations) ?? []

    expect((await cites(expense.id)).some((c) => c.startsWith('sop-'))).toBe(false)
    expect((await cites(maintenance.id)).some((c) => c.startsWith('fin-'))).toBe(false)
  })

  it('修改時不能換成別種申請單', () => {
    const r = mustCreate(service, alice, COMPLETE_EXPENSE, '高鐵票', 'expense')
    // 帶著設備維修的欄位去改報銷單 → 依「報銷單」的定義驗證，所以會失敗
    const result = service.updateRequest(r.id, alice, { title: '改', fields: COMPLETE_LOW_VOLTAGE })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_fields' })
    expect(service.getRequest(r.id)?.formType).toBe('expense')
  })
})
