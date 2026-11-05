import { beforeEach, describe, expect, it } from 'vitest'
import { computeAiStats } from './ai-stats'
import { COMPLETE_LOW_VOLTAGE, INCOMPLETE_HIGH_VOLTAGE, alice, manager, mustCreate } from './fixtures'
import { createRequestService, type RequestService } from './request-service'
import { mockReviewer } from './reviewer'
import { createStore, type Store } from './store'

let store: Store
let service: RequestService
// 用可以調整的時鐘：才測得到「不同天」的趨勢
let clock: Date

beforeEach(() => {
  store = createStore()
  clock = new Date('2026-11-05T10:00:00+08:00')
  service = createRequestService(store, mockReviewer, { now: () => clock })
})

// 建一張單、送出、等預審跑完，回傳這次預審的 id
async function submitted(fields = INCOMPLETE_HIGH_VOLTAGE) {
  const r = mustCreate(service, alice, fields)
  service.sendEvent(r.id, 'SUBMIT', alice)
  await service.waitForReview(r.id)
  return { requestId: r.id, review: service.getLatestReview(r.id)! }
}

// INCOMPLETE_HIGH_VOLTAGE：規則 2 條（index 0、1），AI 1 條（index 2，引用 sop-3.2）
const AI_INDEX = 2

describe('AI 準確度統計', () => {
  it('規則與 AI 的意見分開算；沒有評價的算「未評價」', async () => {
    await submitted()
    const stats = computeAiStats(store, { now: clock })

    expect(stats.totals).toEqual({ reviews: 1, ruleFindings: 2, aiFindings: { total: 1, correct: 0, incorrect: 0 } })
    expect(stats.byFormType).toEqual([
      { formType: 'maintenance', title: '設備維修申請', ruleFindings: 2, aiFindings: { total: 1, correct: 0, incorrect: 0 } },
    ])
  })

  it('同一條意見改過主意，以最後一次評價為準', async () => {
    const { requestId, review } = await submitted()
    service.giveFeedback(requestId, review.id, AI_INDEX, manager, { verdict: 'incorrect', note: '說明夠清楚了' })
    service.giveFeedback(requestId, review.id, AI_INDEX, manager, { verdict: 'correct', note: '' })

    const stats = computeAiStats(store, { now: clock })
    expect(stats.totals.aiFindings).toEqual({ total: 1, correct: 1, incorrect: 0 })
    expect(stats.recentIncorrect).toEqual([])
  })

  it('依條文統計，最常被標記有誤的排最前面，並附上條文內容', async () => {
    const a = await submitted()
    const b = await submitted()
    service.giveFeedback(a.requestId, a.review.id, AI_INDEX, manager, { verdict: 'incorrect', note: '太嚴格' })
    service.giveFeedback(b.requestId, b.review.id, AI_INDEX, manager, { verdict: 'correct', note: '' })

    const [top] = computeAiStats(store, { now: clock }).byPolicy
    expect(top).toMatchObject({ policyId: 'sop-3.2', section: '3.2', total: 2, correct: 1, incorrect: 1 })
    expect(top!.text).toContain('故障現象')
  })

  it('趨勢依台北時間分日，沒有資料的日子也補 0', async () => {
    clock = new Date('2026-11-03T23:30:00+08:00') // 台北時間 11/3 晚上，UTC 已經是 11/3 15:30
    await submitted()
    clock = new Date('2026-11-05T10:00:00+08:00')
    await submitted()

    const stats = computeAiStats(store, { now: clock, days: 3 })
    expect(stats.daily.map((d) => [d.date, d.total])).toEqual([
      ['2026-11-03', 1],
      ['2026-11-04', 0],
      ['2026-11-05', 1],
    ])
  })

  it('有誤的意見列出主管寫的理由，最新的在前', async () => {
    const a = await submitted()
    service.giveFeedback(a.requestId, a.review.id, AI_INDEX, manager, { verdict: 'incorrect', note: '第一筆' })
    clock = new Date('2026-11-05T11:00:00+08:00')
    const b = await submitted()
    service.giveFeedback(b.requestId, b.review.id, AI_INDEX, manager, { verdict: 'incorrect', note: '第二筆' })

    const notes = computeAiStats(store, { now: clock }).recentIncorrect.map((r) => r.note)
    expect(notes).toEqual(['第二筆', '第一筆'])
  })

  it('沒有 AI 意見的預審也算進預審次數', async () => {
    await submitted(COMPLETE_LOW_VOLTAGE)
    const stats = computeAiStats(store, { now: clock })
    expect(stats.totals.reviews).toBe(1)
    expect(stats.totals.aiFindings.total).toBe(0)
    expect(stats.byPolicy).toEqual([])
  })

  it('只有簽核者看得到統計', () => {
    expect(service.getAiStats(alice)).toEqual({ ok: false, reason: 'forbidden' })
    expect(service.getAiStats(manager).ok).toBe(true)
  })
})
