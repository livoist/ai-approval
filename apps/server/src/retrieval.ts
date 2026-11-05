// 檢索（RAG 的 R）：從規範庫裡找出跟這張申請單最相關的條文，只把這些交給 AI
//
// 為什麼要檢索？規範文件一多，全部塞進 prompt 會：
// - 變貴、變慢（每次預審都要付整份規範的 token）
// - 變不準（不相關的條文是雜訊，AI 比較容易引用錯）
//
// 為什麼用 BM25 而不是向量（embedding）？
// - 規範文件的用字很固定：「住宿」「發票」「斷電」，關鍵字比對就很準
// - 不需要額外的 API key 和向量資料庫，結果可以重現、可以寫測試
// - 檢索只是一個函式：之後要換成 embedding，呼叫端一行都不用改

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

  const hits = rank(docs, query)
    .filter((r) => r.score > 0) // 一個詞都沒對到的，就算名額沒滿也不給
    .slice(0, options.topK)
    .map((r) => r.doc.id)
  const chosen = new Set([...(options.mustInclude ?? []), ...hits])
  return docs.filter((d) => chosen.has(d.id))
}
