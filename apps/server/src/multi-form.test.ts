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

describe('清單摘要', () => {
  it('每張單附上目前版本的風險等級；還沒預審的是 null', async () => {
    const draft = mustCreate(service, alice, COMPLETE_EXPENSE, '草稿', 'expense')
    const reviewed = mustCreate(service, alice, COMPLETE_LOW_VOLTAGE)
    await submitAndReview(reviewed.id)

    const byId = Object.fromEntries(service.listSummaries().map((r) => [r.id, r.riskLevel]))
    expect(byId[draft.id]).toBe(null)
    expect(byId[reviewed.id]).toBe('low')
  })
})

describe('第二層簽核', () => {
  const director = { id: 'director', role: 'plant_manager' as const }

  it('金額超過門檻：主管核准 → 待廠長核准 → 廠長核准', async () => {
    const r = mustCreate(service, alice, { ...COMPLETE_EXPENSE, amount: 45_000 }, '大額報銷', 'expense')
    await submitAndReview(r.id)

    expect(service.sendEvent(r.id, 'APPROVE', manager)).toMatchObject({
      ok: true,
      request: { status: 'pending_final_approval' },
    })
    // 主管不能自己把第二關也簽掉
    expect(service.sendEvent(r.id, 'APPROVE', manager)).toEqual({ ok: false, reason: 'forbidden' })
    expect(service.sendEvent(r.id, 'APPROVE', director)).toMatchObject({ ok: true, request: { status: 'approved' } })

    expect(service.getHistory(r.id).map((e) => `${e.actor.id}:${e.event}`).slice(-2)).toEqual([
      'manager:APPROVE',
      'director:APPROVE',
    ])
  })

  it('金額未超過門檻：主管核准就結案，廠長看不到這張單', async () => {
    const r = mustCreate(service, alice, COMPLETE_EXPENSE, '小額報銷', 'expense')
    await submitAndReview(r.id)
    expect(service.sendEvent(r.id, 'APPROVE', manager)).toMatchObject({ request: { status: 'approved' } })
  })

  it('補件時把金額降到門檻以下，重送後就不用廠長', async () => {
    const r = mustCreate(service, alice, { ...COMPLETE_EXPENSE, amount: 45_000 }, '大額報銷', 'expense')
    await submitAndReview(r.id)
    service.sendEvent(r.id, 'APPROVE', manager)
    service.sendEvent(r.id, 'REQUEST_INFO', director)

    service.updateRequest(r.id, alice, { title: '拆單後', fields: { ...COMPLETE_EXPENSE, amount: 20_000 } })
    service.sendEvent(r.id, 'RESUBMIT', alice)
    await service.waitForReview(r.id)
    expect(service.sendEvent(r.id, 'APPROVE', manager)).toMatchObject({ request: { status: 'approved' } })
  })

  it('廠長也可以評價 AI 的意見', async () => {
    const r = mustCreate(service, alice, { ...COMPLETE_EXPENSE, amount: 45_000, purpose: '客戶餐費報銷' }, 'x', 'expense')
    const review = await submitAndReview(r.id)
    const aiIndex = review.findings!.findIndex((f) => f.source === 'ai')
    expect(
      service.giveFeedback(r.id, review.id, aiIndex, director, { verdict: 'correct', note: '' }),
    ).toMatchObject({ ok: true })
  })
})
