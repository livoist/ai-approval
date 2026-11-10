import { createVoyageEmbedder, withEmbeddingCache } from './embedder'
import { bm25Retriever, createHybridRetriever, createVectorRetriever, type Embedder, type Retriever } from './retrieval'

// 依環境變數決定檢索方式：伺服器（index.ts）與產生參考評估的腳本共用，兩邊才會一致
// - 沒有 Voyage 的 API key：只用 BM25，所有功能照常
// - 有的話預設用向量檢索：檢索評估裡，向量在每一題的名次都不輸混合檢索（見 README「檢索」一節）
// - RETRIEVAL_METHOD=hybrid 可以改回 BM25 + 向量的混合檢索
// 不管哪一種，embedding 服務出錯時，單次預審都會退回 BM25（review-context.ts）
export function createRetrievalFromEnv(env: NodeJS.ProcessEnv): { embedder?: Embedder; retriever: Retriever } {
  if (!env.VOYAGE_API_KEY) return { retriever: bm25Retriever }
  const embedder = withEmbeddingCache(
    createVoyageEmbedder({ apiKey: env.VOYAGE_API_KEY, model: env.VOYAGE_MODEL ?? 'voyage-4-lite' }),
  )
  const retriever = env.RETRIEVAL_METHOD === 'hybrid' ? createHybridRetriever(embedder) : createVectorRetriever(embedder)
  return { embedder, retriever }
}
