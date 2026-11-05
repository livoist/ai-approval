import { describe, expect, it } from 'vitest'
import { evalCases, runEval } from './evals'
import { COMPLETE_LOW_VOLTAGE, alice, manager, mustCreate } from './fixtures'
import { policiesFor } from './policies'
import { createRequestService } from './request-service'
import { mockReviewer, type Reviewer } from './reviewer'
import { createStore, type Guideline } from './store'

const NOW = new Date('2026-11-05T10:00:00+08:00')

const guideline = (policyId: string, retired = false): Guideline => ({
  id: `g-${policyId}`,
  policyId,
  text: '說明有現象與發生時間就足夠，不要求完整紀錄',
  sourceFeedbackId: null,
  createdBy: 'manager',
  createdAt: NOW.toISOString(),
  retiredAt: retired ? NOW.toISOString() : null,
  retiredBy: retired ? 'manager' : null,
})

describe('評估集', () => {
  it('每個案例的答案都對得上規範條文，id 不重複', () => {
    const cases = evalCases(NOW)
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
    for (const c of cases) {
      const ids = new Set(policiesFor(c.formType).map((p) => p.id))
      for (const id of [...c.shouldFlag, ...c.shouldNotFlag]) expect(ids.has(id)).toBe(true)
    }
  })

  it('不套用準則：該抓的都抓到，但「簡短但具體」的說明會被誤報', async () => {
    const report = await runEval({ reviewer: mockReviewer, policiesFor, guidelines: [], now: NOW })
    expect(report.baseline.summary).toEqual({ total: 10, passed: 6, expected: 4, caught: 4, falseAlarms: 4 })
    const failed = report.baseline.results.filter((r) => !r.passed).map((r) => r.caseId)
    expect(failed).toEqual(['mnt-ok-short-1', 'mnt-ok-short-2', 'exp-ok-short-1', 'exp-ok-short-2'])
  })

  it('套用 sop-3.2 的準則後，維修單的誤報消失，報銷單不受影響', async () => {
    const report = await runEval({ reviewer: mockReviewer, policiesFor, guidelines: [guideline('sop-3.2')], now: NOW })
    expect(report.withGuidelines.summary).toEqual({ total: 10, passed: 8, expected: 4, caught: 4, falseAlarms: 2 })
    // 對照組不受準則影響
    expect(report.baseline.summary.passed).toBe(6)
    expect(report.guidelines.map((g) => g.policyId)).toEqual(['sop-3.2'])
  })

  it('停用的準則不會套用', async () => {
    const report = await runEval({ reviewer: mockReviewer, policiesFor, guidelines: [guideline('sop-3.2', true)], now: NOW })
    expect(report.guidelines).toEqual([])
    expect(report.withGuidelines.summary.passed).toBe(6)
  })

  it('審查員出錯的案例算沒通過，其他案例照跑', async () => {
    const flaky: Reviewer = {
      name: 'flaky',
      async review(input, policies, hooks) {
        if (input.title === '空調維修') throw new Error('timeout')
        return mockReviewer.review(input, policies, hooks)
      },
    }
    const report = await runEval({ reviewer: flaky, policiesFor, guidelines: [], now: NOW })
    const broken = report.baseline.results.find((r) => r.caseId === 'mnt-vague-2')!
    expect(broken).toMatchObject({ passed: false, error: 'timeout', missed: ['sop-3.2'] })
    expect(report.baseline.summary.total).toBe(10)
  })
})

describe('審查準則接回預審', () => {
  it('主管採用準則後，之後的預審會把準則交給 AI，並記錄在預審結果上', async () => {
    const seen: string[][] = []
    const spy: Reviewer = {
      name: 'spy',
      async review(input, policies, hooks) {
        seen.push(input.guidelines.map((g) => g.policyId))
        return mockReviewer.review(input, policies, hooks)
      },
    }
    const service = createRequestService(createStore(), spy)
    const created = service.createGuideline(manager, { policyId: 'sop-3.2', text: '有現象與時間就夠了' })
    expect(created.ok).toBe(true)
    // 報銷單用不到 sop-3.2：這條準則不會交給 AI
    service.createGuideline(manager, { policyId: 'fin-4.2', text: '每晚未超過上限就不用提' })

    const r = mustCreate(service, alice, COMPLETE_LOW_VOLTAGE)
    service.sendEvent(r.id, 'SUBMIT', alice)
    await service.waitForReview(r.id)

    expect(seen[0]).toEqual(['sop-3.2'])
    expect(service.getLatestReview(r.id)!.appliedGuidelineIds).toEqual([created.ok ? created.guideline.id : ''])
  })

  it('只有簽核者可以新增、停用；同一筆評價不能採用兩次；條文要存在', () => {
    const service = createRequestService(createStore(), mockReviewer)
    expect(service.createGuideline(alice, { policyId: 'sop-3.2', text: 'x' })).toEqual({ ok: false, reason: 'forbidden' })
    expect(service.createGuideline(manager, { policyId: 'sop-99', text: 'x' })).toMatchObject({ reason: 'invalid_guideline' })
    expect(service.createGuideline(manager, { policyId: 'sop-3.2', text: '  ' })).toMatchObject({ reason: 'invalid_guideline' })

    const first = service.createGuideline(manager, { policyId: 'sop-3.2', text: '有現象與時間就夠了', feedbackId: 'fb-1' })
    expect(first.ok).toBe(true)
    expect(service.createGuideline(manager, { policyId: 'sop-3.2', text: '再一次', feedbackId: 'fb-1' })).toEqual({
      ok: false,
      reason: 'already_adopted',
    })

    const id = first.ok ? first.guideline.id : ''
    expect(service.retireGuideline(alice, id)).toEqual({ ok: false, reason: 'forbidden' })
    expect(service.retireGuideline(manager, id)).toEqual({ ok: true })
    expect(service.listGuidelines()[0]!.retiredBy).toBe('manager')
    // 停用之後，同一筆評價可以重新採用（例如改寫準則內容）
    expect(service.createGuideline(manager, { policyId: 'sop-3.2', text: '改寫後的準則', feedbackId: 'fb-1' }).ok).toBe(true)
  })

  it('執行評估會存下紀錄；申請人不能執行', async () => {
    const service = createRequestService(createStore(), mockReviewer)
    expect(await service.startEval(alice)).toEqual({ ok: false, reason: 'forbidden' })
    service.createGuideline(manager, { policyId: 'sop-3.2', text: '有現象與時間就夠了' })

    const result = await service.startEval(manager)
    expect(result.ok).toBe(true)
    const [run] = service.listEvalRuns()
    expect(run).toMatchObject({ reviewer: 'mock', createdBy: 'manager', baseline: { passed: 6 }, withGuidelines: { passed: 8 } })
    expect(service.getEvalRun(run!.id)!.report.cases).toHaveLength(10)
  })
})
