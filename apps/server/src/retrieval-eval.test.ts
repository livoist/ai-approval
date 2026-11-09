import { describe, expect, it } from 'vitest'
import { bm25Retriever, createHybridRetriever, createVectorRetriever, type Embedder } from './retrieval'
import { withQueryPrefetch } from './embedder'
import { corpusFor, evaluateRetrieval, RETRIEVAL_CASES } from './retrieval-eval'

// 假的 embedding：只認得幾組同義詞，把文字轉成「有沒有提到這個概念」的向量
// 用來驗證混合檢索的合併邏輯，不代表真實 embedding 的表現
const CONCEPTS = [
  ['計程車', '小黃'],
  ['住宿', '過夜'],
  ['高鐵'],
]
const fakeEmbedder: Embedder = {
  name: 'fake',
  async embed(texts) {
    // 最後補一個很小的常數維度：沒提到任何概念的文字，向量才不會全是 0
    return texts.map((t) => [...CONCEPTS.map((words): number => (words.some((w) => t.includes(w)) ? 1 : 0)), 0.01])
  },
}

describe('檢索評估', () => {
  it('每一題的答案都在候選條文裡', () => {
    for (const c of RETRIEVAL_CASES) {
      const ids = new Set(corpusFor(c.formType).map((p) => p.id))
      for (const id of c.relevant) expect(ids.has(id)).toBe(true)
    }
  })

  it('BM25：用字相同的題目全部命中，換句話說的找不到', async () => {
    const report = await evaluateRetrieval(bm25Retriever)
    expect(report.byType.lexical.recall).toBe(1)
    expect(report.byType.paraphrase.recall).toBe(0)
  })

  it('向量檢索找得到換句話說的條文；混合檢索兩種都顧到', async () => {
    const cases = RETRIEVAL_CASES.filter((c) => ['lx-hsr', 'pp-taxi'].includes(c.id))
    const bm25 = await evaluateRetrieval(bm25Retriever, { cases })
    const vector = await evaluateRetrieval(createVectorRetriever(fakeEmbedder), { cases })
    const hybrid = await evaluateRetrieval(createHybridRetriever(fakeEmbedder), { cases })

    expect(bm25.results.map((r) => r.hit)).toEqual([true, false])
    expect(vector.results.map((r) => r.hit)).toEqual([true, true])
    expect(hybrid.results.map((r) => r.hit)).toEqual([true, true])
    expect(hybrid.method).toBe('hybrid(fake)')
  })

  it('先批次轉好題目：向量與混合各跑一次，題目只送一次 API', async () => {
    const queryCalls: number[] = []
    const counting: Embedder = {
      name: 'counting',
      async embed(texts, inputType) {
        if (inputType === 'query') queryCalls.push(texts.length)
        return fakeEmbedder.embed(texts, inputType)
      },
    }
    const prefetched = withQueryPrefetch(counting)
    await prefetched.prefetch(RETRIEVAL_CASES.map((c) => c.query))
    const vector = await evaluateRetrieval(createVectorRetriever(prefetched))
    await evaluateRetrieval(createHybridRetriever(prefetched))

    expect(queryCalls).toEqual([RETRIEVAL_CASES.length])
    // 結果跟沒有先批次轉換時一樣
    expect(vector.results).toEqual((await evaluateRetrieval(createVectorRetriever(fakeEmbedder))).results)
  })
})
