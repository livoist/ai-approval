import { describe, expect, it } from 'vitest'
import { createRequestService, type CurrentUser, type ReviewStreamEvent } from './request-service'
import { mockReviewer, type Reviewer } from './reviewer'
import { createStore } from './store'

const alice: CurrentUser = { id: 'alice', role: 'applicant' }

describe('預審串流', () => {
  it('依序推播：預審中 → 一條一條意見 → 待簽核', async () => {
    const service = createRequestService(createStore(), mockReviewer)
    const r = service.createRequest(alice, { title: '高壓設備維修', description: '馬達異音' })

    const events: ReviewStreamEvent[] = []
    const unsubscribe = service.subscribe(r.id, (e) => events.push(e))

    service.sendEvent(r.id, 'SUBMIT', alice)
    await service.waitForReview(r.id)
    unsubscribe()

    expect(events.map((e) => (e.type === 'status' ? e.status : e.type))).toEqual([
      'draft', // 訂閱當下的狀態
      'reviewing',
      'finding',
      'finding',
      'finding',
      'pending_approval',
    ])
  })

  it('晚加入的人會先收到已經審出來的意見', async () => {
    // 審出一條之後就停住，等我們放行
    let release!: () => void
    const paused: Reviewer = {
      name: 'paused',
      async review(_input, _policies, hooks) {
        const finding = { kind: 'risk' as const, message: '第一條', citations: ['sop-4.3'] }
        hooks?.onFinding?.(finding)
        await new Promise<void>((resolve) => (release = resolve))
        return { riskLevel: 'medium', summary: '', findings: [finding] }
      },
    }
    const service = createRequestService(createStore(), paused)
    const r = service.createRequest(alice, { title: '維修', description: '' })
    service.sendEvent(r.id, 'SUBMIT', alice)

    // 這時候才打開頁面
    const events: ReviewStreamEvent[] = []
    service.subscribe(r.id, (e) => events.push(e))
    expect(events).toEqual([
      { type: 'finding', version: 1, finding: { kind: 'risk', message: '第一條', citations: ['sop-4.3'] } },
      { type: 'status', status: 'reviewing' },
    ])

    release()
    await service.waitForReview(r.id)
  })

  it('串流中的引用也會被驗證', async () => {
    const hallucinating: Reviewer = {
      name: 'hallucinating',
      async review(_input, _policies, hooks) {
        const finding = { kind: 'risk' as const, message: 'x', citations: ['sop-4.2', 'sop-99.9'] }
        hooks?.onFinding?.(finding)
        return { riskLevel: 'high', summary: '', findings: [finding] }
      },
    }
    const service = createRequestService(createStore(), hallucinating)
    const r = service.createRequest(alice, { title: '維修', description: '' })

    const findings: string[][] = []
    service.subscribe(r.id, (e) => {
      if (e.type === 'finding') findings.push(e.finding.citations)
    })
    service.sendEvent(r.id, 'SUBMIT', alice)
    await service.waitForReview(r.id)

    expect(findings).toEqual([['sop-4.2']])
  })
})
