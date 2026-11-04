import { RULES, runRules } from '@ai-approval/shared'
import { describe, expect, it } from 'vitest'
import { POLICY_CHUNKS } from './policies'

// 規則引擎寫在 shared，規範條文在 server：兩邊各自維護，很容易某天對不上
// 這個測試確保規則引用的每一條條文都真的存在，畫面上的引用一定點得開
describe('規則與規範條文一致', () => {
  it('所有規則引用的條文 id 都存在', () => {
    const known = new Set(POLICY_CHUNKS.map((p) => p.id))
    // 用一組會觸發所有規則的資料，收集每條規則的引用
    const all = runRules({ voltage: 480, estimatedCost: 10_000_000 })
    expect(all).toHaveLength(RULES.length)
    for (const f of all) {
      for (const id of f.citations) expect(known.has(id)).toBe(true)
    }
  })
})
