import { describe, expect, it } from 'vitest'
import { rank, selectRelevant, tokenize } from './retrieval'

const docs = [
  { id: 'a', text: '國內出差住宿費，每晚以新台幣 3,000 元為上限。' },
  { id: 'b', text: '業務招待費每人平均以新台幣 2,000 元為上限。' },
  { id: 'c', text: '報銷應檢附統一發票或收據正本。' },
  { id: 'd', text: '搭乘高鐵以標準車廂為限。' },
]

describe('斷詞', () => {
  it('中文切成相鄰兩個字，英文與數字整個保留', () => {
    expect(tokenize('住宿費用')).toEqual(['住宿', '宿費', '費用'])
    expect(tokenize('480V 高壓 LOTO')).toEqual(['480v', '高壓', 'loto'])
    expect(tokenize('第 4.2 條')).toEqual(['第', '4.2', '條'])
  })
})

describe('檢索', () => {
  it('最相關的條文排在最前面', () => {
    expect(rank(docs, '台南出差住宿兩晚')[0]!.doc.id).toBe('a')
    expect(rank(docs, '台北新竹往返高鐵票')[0]!.doc.id).toBe('d')
  })

  it('條文不多時全部給，不冒漏掉的風險', () => {
    expect(selectRelevant(docs, '高鐵', { topK: 4 })).toEqual(docs)
  })

  it('只挑分數大於 0 的前幾名，並維持原本的條文順序', () => {
    const picked = selectRelevant(docs, '出差住宿與高鐵', { topK: 2 })
    expect(picked.map((d) => d.id)).toEqual(['a', 'd'])
  })

  it('一定要給的條文，就算完全沒對到也會放進去', () => {
    const picked = selectRelevant(docs, '高鐵', { topK: 1, mustInclude: ['c'] })
    expect(picked.map((d) => d.id)).toEqual(['c', 'd'])
  })
})
