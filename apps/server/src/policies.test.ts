import { FORM_TYPES, getFormKind } from '@ai-approval/shared'
import { describe, expect, it } from 'vitest'
import { CORE_POLICIES, POLICY_CHUNKS, policiesFor } from './policies'

// 規則寫在 shared，規範條文在 server：兩邊各自維護，很容易某天對不上
// 這組測試確保每種申請單的規則，引用的條文都真的存在、而且屬於「這種單」的規範文件
describe('規則與規範條文一致', () => {
  for (const type of FORM_TYPES) {
    it(`${type}：每條規則引用的條文都在它自己的規範文件裡`, () => {
      const ownIds = new Set(policiesFor(type).map((p) => p.id))
      expect(ownIds.size > 0).toBe(true)
      for (const rule of getFormKind(type).rules) {
        for (const id of rule.cites) expect(ownIds.has(id)).toBe(true)
      }
    })
  }

  for (const type of FORM_TYPES) {
    it(`${type}：核心條文都在它自己的規範文件裡`, () => {
      const ownIds = new Set(policiesFor(type).map((p) => p.id))
      for (const id of CORE_POLICIES[type]) expect(ownIds.has(id)).toBe(true)
    })
  }

  it('條文 id 不重複', () => {
    const ids = POLICY_CHUNKS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
