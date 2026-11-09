import { describe, expect, it } from 'vitest'
import { mustCreate, COMPLETE_LOW_VOLTAGE, INCOMPLETE_HIGH_VOLTAGE, alice, manager } from './fixtures'
import { POLICY_CHUNKS } from './policies'
import { createRequestService } from './request-service'
import { mockReviewer, validateCitations, type Reviewer } from './reviewer'
import { createStore } from './store'

describe('validateCitations', () => {
  it('剔除不存在的條文 id（AI 幻覺）', () => {
    const result = validateCitations(
      {
        riskLevel: 'high',
        summary: '',
        findings: [{ kind: 'risk', message: 'x', citations: ['sop-4.2', 'sop-99.9'] }],
      },
      POLICY_CHUNKS,
    )
    expect(result.findings[0]?.citations).toEqual(['sop-4.2'])
  })
})

describe('AI 預審流程', () => {
  it('送出後自動預審，完成後進入待簽核', async () => {
    const service = createRequestService(createStore(), mockReviewer)
    const r = mustCreate(service, alice, INCOMPLETE_HIGH_VOLTAGE)

    const submitted = service.sendEvent(r.id, 'SUBMIT', alice)
    expect(submitted).toMatchObject({ ok: true, request: { status: 'reviewing' } })

    await service.waitForReview(r.id)
    expect(service.getRequest(r.id)?.status).toBe('pending_approval')

    const review = service.getLatestReview(r.id)
    expect(review?.riskLevel).toBe('high')
    expect(review?.findings?.some((f) => f.citations.includes('sop-4.2'))).toBe(true)
  })

  it('AI 出錯時退回草稿，並留下失敗紀錄', async () => {
    const broken: Reviewer = {
      name: 'broken',
      review: async () => {
        throw new Error('timeout')
      },
    }
    const service = createRequestService(createStore(), broken)
    const r = mustCreate(service, alice, COMPLETE_LOW_VOLTAGE)
    service.sendEvent(r.id, 'SUBMIT', alice)
    await service.waitForReview(r.id)

    expect(service.getRequest(r.id)?.status).toBe('draft')
    expect(service.getLatestReview(r.id)).toMatchObject({ status: 'failed', error: 'timeout' })
  })

  it('伺服器重啟後，接續處理卡在預審中的申請單', async () => {
    const store = createStore()

    // 模擬重啟前：送出後、還沒審完伺服器就停了（沒有 reviewer，所以不會自動預審）
    const before = createRequestService(store)
    const r = mustCreate(before, alice, INCOMPLETE_HIGH_VOLTAGE)
    before.sendEvent(r.id, 'SUBMIT', alice)
    expect(before.getRequest(r.id)?.status).toBe('reviewing')

    // 模擬重啟後：同一份資料、新的 service
    const after = createRequestService(store, mockReviewer)
    expect(after.resumeInterruptedReviews()).toBe(1)
    await after.waitForReview(r.id)
    expect(after.getRequest(r.id)?.status).toBe('pending_approval')
  })

  it('預審進行中主管還不能核准，跑完才進入待簽核', async () => {
    // 一個要等我們「放行」才會回傳結果的審查員，用來模擬 AI 思考中
    // 預審前的準備（檢索）是非同步的，審查員不是一送出就被呼叫：用 started 等它真的開始
    let release!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((r) => (markStarted = r))
    const slow: Reviewer = {
      name: 'slow',
      review: (input, policies) =>
        new Promise((resolve) => {
          release = () => resolve(mockReviewer.review(input, policies))
          markStarted()
        }),
    }
    const service = createRequestService(createStore(), slow)
    const r = mustCreate(service, alice, COMPLETE_LOW_VOLTAGE)
    service.sendEvent(r.id, 'SUBMIT', alice)

    // AI 還在想的時候，主管不能核准（還沒輪到他）
    expect(service.sendEvent(r.id, 'APPROVE', manager)).toMatchObject({ ok: false })

    await started
    expect(service.sendEvent(r.id, 'APPROVE', manager)).toMatchObject({ ok: false })
    release()
    await service.waitForReview(r.id)
    expect(service.getRequest(r.id)?.status).toBe('pending_approval')
  })
})
