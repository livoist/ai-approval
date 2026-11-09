import type { Embedder } from './retrieval'

// Voyage AI 的 embedding API（Anthropic 推薦的 embedding 服務）
// 沒有設定 VOYAGE_API_KEY 時不會用到這個檔案，檢索只用 BM25
const ENDPOINT = 'https://api.voyageai.com/v1/embeddings'
const BATCH = 128 // 一次最多送幾段文字

export function createVoyageEmbedder(options: { apiKey: string; model: string }): Embedder {
  return {
    name: options.model,
    async embed(texts, inputType) {
      const vectors: number[][] = []
      for (let i = 0; i < texts.length; i += BATCH) {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: texts.slice(i, i + BATCH), model: options.model, input_type: inputType }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) throw new Error(`Voyage API ${res.status}: ${(await res.text()).slice(0, 200)}`)
        const body = (await res.json()) as { data: { embedding: number[]; index: number }[] }
        // 依 index 排回原本的順序，不假設 API 回傳的順序
        const batch = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
        vectors.push(...batch)
      }
      return vectors
    },
  }
}

// 快取：規範條文不常變，每次預審都重新轉一次向量是浪費錢
// 只快取 document（條文）；query（申請內容）每次都不一樣，快取了也用不到
export function withEmbeddingCache(embedder: Embedder): Embedder {
  const cache = new Map<string, number[]>()
  return {
    name: embedder.name,
    async embed(texts, inputType) {
      if (inputType === 'query') return embedder.embed(texts, inputType)
      const missing = [...new Set(texts.filter((t) => !cache.has(t)))]
      if (missing.length > 0) {
        const vectors = await embedder.embed(missing, inputType)
        missing.forEach((t, i) => cache.set(t, vectors[i]!))
      }
      return texts.map((t) => cache.get(t)!)
    },
  }
}

// 評估用：先把一批 query 一次轉好，之後同樣的 query 直接用
// 檢索評估有 16 題，向量與混合各查一次：一題一題送，短時間內會打 30 幾次 API，容易撞到速率上限
// 先批次轉好，整次評估只要呼叫幾次（題目一次、每種申請單的條文各一次）
export function withQueryPrefetch(embedder: Embedder): Embedder & { prefetch(queries: string[]): Promise<void> } {
  const memo = new Map<string, number[]>()
  return {
    name: embedder.name,
    async prefetch(queries) {
      const missing = [...new Set(queries)].filter((q) => !memo.has(q))
      if (missing.length === 0) return
      const vectors = await embedder.embed(missing, 'query')
      missing.forEach((q, i) => memo.set(q, vectors[i]!))
    },
    async embed(texts, inputType) {
      if (inputType === 'query' && texts.every((t) => memo.has(t))) return texts.map((t) => memo.get(t)!)
      return embedder.embed(texts, inputType)
    },
  }
}
