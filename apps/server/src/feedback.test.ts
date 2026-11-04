import { beforeEach, describe, expect, it } from 'vitest'
import { mustCreate, INCOMPLETE_HIGH_VOLTAGE, alice, manager } from './fixtures'
import { createRequestService, type RequestService } from './request-service'
import { mockReviewer } from './reviewer'
import { createStore } from './store'

let service: RequestService
let requestId: string
let reviewId: string

// 每個測試都從「一張已經預審完、有 3 條意見的單」開始
beforeEach(async () => {
  service = createRequestService(createStore(), mockReviewer)
  const r = mustCreate(service, alice, INCOMPLETE_HIGH_VOLTAGE)
  requestId = r.id
  service.sendEvent(r.id, 'SUBMIT', alice)
  await service.waitForReview(r.id)
  reviewId = service.getLatestReview(r.id)!.id
})

describe('主管評價 AI 意見', () => {
  it('標記為正確，預審結果上看得到', () => {
    const result = service.giveFeedback(requestId, reviewId, 0, manager, {
      verdict: 'correct',
      note: '',
    })
    expect(result.ok).toBe(true)
    expect(service.getLatestReview(requestId)?.findings?.[0]?.feedback).toMatchObject({
      verdict: 'correct',
      actorId: 'manager',
    })
  })

  it('還沒評價的意見，feedback 是 null', () => {
    expect(service.getLatestReview(requestId)?.findings?.[1]?.feedback).toBe(null)
  })

  it('標記為有誤必須寫理由', () => {
    expect(
      service.giveFeedback(requestId, reviewId, 0, manager, { verdict: 'incorrect', note: '   ' }),
    ).toEqual({ ok: false, reason: 'note_required' })
  })

  it('申請人不能評價', () => {
    expect(
      service.giveFeedback(requestId, reviewId, 0, alice, { verdict: 'correct', note: '' }),
    ).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('不存在的意見或預審 → not_found', () => {
    const input = { verdict: 'correct' as const, note: '' }
    expect(service.giveFeedback(requestId, reviewId, 99, manager, input)).toMatchObject({
      reason: 'not_found',
    })
    expect(service.giveFeedback(requestId, 'nope', 0, manager, input)).toMatchObject({
      reason: 'not_found',
    })
  })

  it('改主意時以最新的評價為準', () => {
    service.giveFeedback(requestId, reviewId, 0, manager, { verdict: 'correct', note: '' })
    service.giveFeedback(requestId, reviewId, 0, manager, {
      verdict: 'incorrect',
      note: '這台不是高壓設備',
    })
    expect(service.getLatestReview(requestId)?.findings?.[0]?.feedback).toMatchObject({
      verdict: 'incorrect',
      note: '這台不是高壓設備',
    })
  })
})
