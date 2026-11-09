import { beforeEach, describe, expect, it } from 'vitest'
import { COMPLETE_LOW_VOLTAGE, INCOMPLETE_HIGH_VOLTAGE, alice, bob, manager, mustCreate } from './fixtures'
import { createRequestService, type RequestService } from './request-service'
import { mockReviewer } from './reviewer'
import { createStore } from './store'

let service: RequestService

beforeEach(() => {
  service = createRequestService(createStore(), mockReviewer)
})

describe('建立申請單：表單驗證', () => {
  it('格式錯誤時回傳每個欄位的錯誤訊息', () => {
    const result = service.createRequest(alice, {
      formType: 'maintenance',
      title: '維修',
      fields: { ...COMPLETE_LOW_VOLTAGE, equipmentId: 'abc', voltage: null },
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_fields' })
    if (!result.ok && result.reason === 'invalid_fields') {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(['equipmentId', 'voltage'])
    }
  })

  it('標題必填', () => {
    expect(service.createRequest(alice, {
      formType: 'maintenance',
      title: '  ', fields: COMPLETE_LOW_VOLTAGE })).toMatchObject({
      reason: 'invalid_fields',
      fieldErrors: { title: '請填寫標題' },
    })
  })

  it('主管不能建立申請單', () => {
    expect(service.createRequest(manager, {
      formType: 'maintenance',
      title: '維修', fields: COMPLETE_LOW_VOLTAGE })).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it('看不到的欄位不會被存下來', () => {
    // 低壓設備卻偷塞了高壓欄位：表單不會顯示它，所以也不該存
    const r = mustCreate(service, alice, { ...COMPLETE_LOW_VOLTAGE, lockoutBy: '陳工程師' })
    expect('lockoutBy' in r.fields).toBe(false)
  })
})

describe('修改申請內容', () => {
  it('草稿可以修改，並留下 UPDATE 紀錄', () => {
    const r = mustCreate(service, alice)
    const result = service.updateRequest(r.id, alice, {
      title: '改過的標題',
      fields: { ...COMPLETE_LOW_VOLTAGE, estimatedCost: 50000 },
    })
    expect(result).toMatchObject({ ok: true, request: { title: '改過的標題', fields: { estimatedCost: 50000 } } })
    expect(service.getHistory(r.id).map((e) => e.event)).toEqual(['CREATE', 'UPDATE'])
  })

  it('別人的單不能改', () => {
    const r = mustCreate(service, alice)
    expect(service.updateRequest(r.id, bob, { title: 'x', fields: COMPLETE_LOW_VOLTAGE })).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it('送出之後就不能改，要等主管要求補件', async () => {
    const r = mustCreate(service, alice)
    service.sendEvent(r.id, 'SUBMIT', alice)
    await service.waitForReview(r.id)
    const input = { title: 'x', fields: COMPLETE_LOW_VOLTAGE }
    expect(service.updateRequest(r.id, alice, input)).toMatchObject({ reason: 'invalid_transition' })

    service.sendEvent(r.id, 'REQUEST_INFO', manager)
    expect(service.updateRequest(r.id, alice, input)).toMatchObject({ ok: true })
  })
})

describe('預審：規則引擎 + AI', () => {
  it('規則的意見在前、AI 的在後，各自標上來源', async () => {
    const r = mustCreate(service, alice, INCOMPLETE_HIGH_VOLTAGE)
    service.sendEvent(r.id, 'SUBMIT', alice)
    await service.waitForReview(r.id)

    const review = service.getLatestReview(r.id)!
    expect(review.findings?.map((f) => `${f.source}:${f.citations[0]}`)).toEqual([
      'rule:sop-4.2',
      'rule:sop-4.3',
      'ai:sop-3.2',
    ])
    // 規則找到「缺漏」→ 高風險，即使 AI 自己只評中風險
    expect(review.riskLevel).toBe('high')
  })

  it('資料完整時，規則和 AI 都沒有意見', async () => {
    const r = mustCreate(service, alice, COMPLETE_LOW_VOLTAGE)
    service.sendEvent(r.id, 'SUBMIT', alice)
    await service.waitForReview(r.id)
    expect(service.getLatestReview(r.id)).toMatchObject({ riskLevel: 'low', findings: [] })
  })

  it('超過 50 萬元：提醒要部門主管核准', async () => {
    const r = mustCreate(service, alice, { ...COMPLETE_LOW_VOLTAGE, estimatedCost: 800_000 })
    service.sendEvent(r.id, 'SUBMIT', alice)
    await service.waitForReview(r.id)
    expect(service.getLatestReview(r.id)?.findings?.[0]).toMatchObject({
      kind: 'notice',
      citations: ['sop-5.1'],
      source: 'rule',
    })
  })
})
