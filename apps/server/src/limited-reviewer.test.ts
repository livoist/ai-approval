import { describe, expect, it } from 'vitest'
import { createLimitedReviewer } from './limited-reviewer'
import type { ReviewInput, Reviewer } from './reviewer'

const input: ReviewInput = {
  formType: 'maintenance',
  formTitle: '設備維修申請',
  title: 't',
  values: {},
  details: [],
  narrative: '',
  ruleFindings: [],
  guidelines: [],
  removedInjections: 0,
}

// 會記錄被呼叫幾次的假審查員
function fake(name: string, behavior: 'ok' | 'throw' = 'ok') {
  const reviewer: Reviewer & { calls: number } = {
    name,
    calls: 0,
    async review() {
      reviewer.calls++
      if (behavior === 'throw') throw new Error('boom')
      return { riskLevel: 'low', summary: name, findings: [] }
    },
  }
  return reviewer
}

describe('有使用上限的審查員', () => {
  it('額度內用主要審查員，用完改用備援', async () => {
    const claude = fake('claude')
    const mock = fake('mock')
    const limited = createLimitedReviewer(claude, mock, { dailyLimit: 2 })

    await limited.review(input, [])
    await limited.review(input, [])
    const third = await limited.review(input, [])

    expect(claude.calls).toBe(2)
    expect(mock.calls).toBe(1)
    expect(third.usedReviewer).toBe('mock（今日 AI 額度已用完）')
    expect(limited.usage()).toEqual({ used: 2, limit: 2 })
  })

  it('主要審查員出錯時改用備援，而不是讓預審失敗', async () => {
    const limited = createLimitedReviewer(fake('claude', 'throw'), fake('mock'), { dailyLimit: 10 })
    const result = await limited.review(input, [])
    expect(result.usedReviewer).toBe('mock（AI 暫時無法使用）')
  })

  it('台灣時間換日後，額度重新計算', async () => {
    let clock = new Date('2026-11-05T15:59:00Z') // 台灣時間 23:59
    const claude = fake('claude')
    const limited = createLimitedReviewer(claude, fake('mock'), { dailyLimit: 1, now: () => clock })

    await limited.review(input, [])
    expect(limited.usage().used).toBe(1)

    clock = new Date('2026-11-05T16:01:00Z') // 台灣時間隔天 00:01
    expect(limited.usage().used).toBe(0)
    await limited.review(input, [])
    expect(claude.calls).toBe(2)
  })
})
