import { describe, expect, it } from 'vitest'
import { extractCompletedFindings } from './partial-json'

const full =
  '{"findings":[{"kind":"missing","message":"未載明設備編號","citations":["sop-3.1"]},{"kind":"risk","message":"未提及上鎖掛牌","citations":["sop-4.3"]}],"riskLevel":"high","summary":"…"}'

describe('extractCompletedFindings', () => {
  it('還沒出現 findings 時回傳空陣列', () => {
    expect(extractCompletedFindings('{"fin')).toEqual([])
  })

  it('只取出已經完整的物件，收到一半的不算', () => {
    // 切在第二個 finding 的中間
    const partial = full.slice(0, full.indexOf('"risk"') + 4)
    expect(extractCompletedFindings(partial)).toEqual([
      { kind: 'missing', message: '未載明設備編號', citations: ['sop-3.1'] },
    ])
  })

  it('整段收完時取出全部', () => {
    expect(extractCompletedFindings(full)).toHaveLength(2)
  })

  it('字串裡的大括號與跳脫的引號不會干擾判斷', () => {
    const tricky = '{"findings":[{"kind":"risk","message":"含有 } 與 \\"引號\\" 的說明","citations":[]}'
    expect(extractCompletedFindings(tricky)).toEqual([
      { kind: 'risk', message: '含有 } 與 "引號" 的說明', citations: [] },
    ])
  })

  it('逐字餵入時，數量只會增加不會減少', () => {
    let last = 0
    for (let i = 0; i <= full.length; i++) {
      const n = extractCompletedFindings(full.slice(0, i)).length
      expect(n >= last).toBe(true)
      last = n
    }
    expect(last).toBe(2)
  })
})
