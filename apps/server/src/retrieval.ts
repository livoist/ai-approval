// 檢索（RAG 的 R）：從規範庫裡找出跟這張申請單最相關的條文，只把這些交給 AI
//
// 為什麼要檢索？規範文件一多，全部塞進 prompt 會：
// - 變貴、變慢（每次預審都要付整份規範的 token）
// - 變不準（不相關的條文是雜訊，AI 比較容易引用錯）
//
// 三種檢索方式（Retriever 介面，見下方）：
// - BM25：關鍵字比對。規範的用字很固定（住宿、發票、斷電），用字相同時很準，不需要外部服務，結果可以重現
// - 向量（embedding）：比的是意思，「搭小黃」找得到「計程車」，但需要 embedding 服務
// - 混合：兩種各排一次名再合併，截長補短。有設定 VOYAGE_API_KEY 時預設用這個
// 哪一種比較好，不靠感覺：retrieval-eval.ts 用同一組題目比較

export interface Searchable {
  id: string
  text: string
}

const CJK = /[㐀-鿿豈-﫿]/

// 斷詞：中文沒有空白，用「相鄰兩個字」（bigram）當詞
// 「住宿費用」→ 住宿、宿費、費用；英文與數字則整個字當一個詞
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const runs = text.toLowerCase().match(/[㐀-鿿豈-﫿]+|[a-z0-9]+(?:\.[0-9]+)*/g) ?? []
  for (const run of runs) {
    if (!CJK.test(run)) {
      tokens.push(run)
    } else if (run.length === 1) {
      tokens.push(run)
    } else {
      for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
    }
  }
  return tokens
}

// BM25：經典的關鍵字檢索評分
// - 詞在這條出現越多次，分數越高，但有上限（k1）：同一個詞重複十次不會比兩次重要五倍
// - 越少條文有的詞越重要（IDF）：「應」到處都有，「住宿」只有幾條有
// - 條文越長，分數打折（b）：長條文本來就容易碰到各種詞
const K1 = 1.5
const B = 0.75

export function rank<T extends Searchable>(docs: readonly T[], query: string): { doc: T; score: number }[] {
  const docTokens = docs.map((d) => tokenize(d.text))
  const avgLen = docTokens.reduce((sum, t) => sum + t.length, 0) / Math.max(docs.length, 1)

  // 每個詞出現在幾條條文裡
  const df = new Map<string, number>()
  for (const tokens of docTokens) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1)

  const queryTokens = [...new Set(tokenize(query))]

  return docs
    .map((doc, i) => {
      const tokens = docTokens[i]!
      const tf = new Map<string, number>()
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)

      let score = 0
      for (const q of queryTokens) {
        const f = tf.get(q)
        if (!f) continue
        const n = df.get(q) ?? 0
        const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
        score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * tokens.length) / avgLen))
      }
      return { doc, score }
    })
    .sort((a, b) => b.score - a.score)
}

// 挑出要給 AI 的條文：
// - 條文不多（≤ topK）就全部給，沒有必要冒漏掉的風險
// - 規則已經引用的條文一定要給：AI 需要知道規則查到了什麼
// - 結果維持原本的條文順序，AI 讀起來跟原文件一樣
export function selectRelevant<T extends Searchable>(
  docs: readonly T[],
  query: string,
  options: { topK: number; mustInclude?: readonly string[] },
): T[] {
  if (docs.length <= options.topK) return [...docs]
  // 一個詞都沒對到的，就算名額沒滿也不給
  const ranked = rank(docs, query)
    .filter((r) => r.score > 0)
    .map((r) => ({ id: r.doc.id, score: r.score }))
  return pickRelevant(docs, ranked, options)
}

// 依排名挑出前 topK 條，加上一定要給的，維持原本的條文順序
export function pickRelevant<T extends Searchable>(
  docs: readonly T[],
  ranked: readonly Ranked[],
  options: { topK: number; mustInclude?: readonly string[] },
): T[] {
  const chosen = new Set([...(options.mustInclude ?? []), ...ranked.slice(0, options.topK).map((r) => r.id)])
  return docs.filter((d) => chosen.has(d.id))
}

// ===== 檢索方式可以替換：BM25、向量、混合 =====
// 「檢索」是一個介面，跟審查員一樣：預審與評估只依賴介面，換方法時呼叫端不用改

export interface Ranked {
  id: string
  score: number
}

export interface Retriever {
  readonly name: string
  // 由相關到不相關排序；完全不相關的可以不列
  rank(docs: readonly Searchable[], query: string): Promise<Ranked[]>
}

// 把文字轉成向量的服務（例如 Voyage AI）；input_type 分 query 與 document，兩者的轉法不同
export interface Embedder {
  readonly name: string
  embed(texts: string[], inputType: 'query' | 'document'): Promise<number[][]>
}

export const bm25Retriever: Retriever = {
  name: 'bm25',
  async rank(docs, query) {
    return rank(docs, query)
      .filter((r) => r.score > 0)
      .map((r) => ({ id: r.doc.id, score: r.score }))
  },
}

function cosine(a: number[], b: number[]) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

// 向量檢索：意思相近就找得到，不需要用字相同
// 「搭小黃」找得到「計程車」的規定，這是 BM25 做不到的
export function createVectorRetriever(embedder: Embedder): Retriever {
  return {
    name: `vector(${embedder.name})`,
    async rank(docs, query) {
      const [docVectors, [queryVector]] = await Promise.all([
        embedder.embed(
          docs.map((d) => d.text),
          'document',
        ),
        embedder.embed([query], 'query'),
      ])
      return docs
        .map((d, i) => ({ id: d.id, score: cosine(queryVector!, docVectors[i]!) }))
        .sort((a, b) => b.score - a.score)
    },
  }
}

// 混合檢索：BM25 與向量各排一次名，用 Reciprocal Rank Fusion 合併
// RRF 只看名次、不看分數：BM25 的分數與向量的相似度單位不同，直接相加沒有意義，名次就可以比
// 兩邊都排前面的條文分數最高；只有一邊找到的也有機會進榜，兩種方法互補
const RRF_K = 60
export function createHybridRetriever(embedder: Embedder): Retriever {
  const vector = createVectorRetriever(embedder)
  return {
    name: `hybrid(${embedder.name})`,
    async rank(docs, query) {
      const [lexical, semantic] = await Promise.all([bm25Retriever.rank(docs, query), vector.rank(docs, query)])
      const scores = new Map<string, number>()
      for (const list of [lexical, semantic]) {
        list.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + i + 1)))
      }
      return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
    },
  }
}
