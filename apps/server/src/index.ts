import express from 'express'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { createClaudeReviewer } from './claude-reviewer'
import { createVoyageEmbedder, withEmbeddingCache } from './embedder'
import { createLimitedReviewer, type LimitedReviewer } from './limited-reviewer'
import { createRequestService } from './request-service'
import { bm25Retriever, createHybridRetriever, createVectorRetriever } from './retrieval'
import { createMockReviewer, type Reviewer } from './reviewer'
import { seedDemoData } from './seed'
import { createSqliteStore } from './sqlite-store'

// 讀取 .env（Node 內建功能，不用另外裝 dotenv）；沒有這個檔案就略過
// 已經存在的環境變數優先，所以部署平台或 E2E 設定的值不會被 .env 蓋掉
try {
  process.loadEnvFile()
} catch {}

const env = process.env
const DEMO = env.DEMO === 'true'

// ===== AI 審查員 =====
// 沒有 API key：模擬審查員（E2E 測試時調短間隔，讓測試跑得快）
// 有 API key：Claude；如果有設 AI_DAILY_LIMIT，就包上一層每日上限，用完改回模擬審查員
const mock = createMockReviewer({ delayMs: Number(env.MOCK_DELAY_MS ?? 800) })
let limited: LimitedReviewer | null = null
let reviewer: Reviewer = mock

if (env.ANTHROPIC_API_KEY) {
  const claude = createClaudeReviewer({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
  })
  reviewer = claude
  if (env.AI_DAILY_LIMIT) {
    limited = createLimitedReviewer(claude, mock, { dailyLimit: Number(env.AI_DAILY_LIMIT) })
    reviewer = limited
  }
}

// ===== 資料 =====
// DB_PATH 設成 :memory: 時只存在記憶體：E2E 測試、公開 demo 每次啟動都是乾淨的資料
// 想清空本機資料：pnpm --filter @ai-approval/server db:reset
const DB_PATH = env.DB_PATH ?? 'data/app.db'
if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true })
const store = createSqliteStore(DB_PATH)

// 公開 demo：資料庫是空的就放入示範資料
const seeded = DEMO ? await seedDemoData(store) : 0

// ===== 組裝 =====
// ===== 檢索 =====
// 沒有 Voyage 的 API key：只用 BM25，所有功能照常
// 有的話預設用向量檢索：檢索評估裡，向量在每一題的名次都不輸混合檢索（見 README「檢索」一節）
// RETRIEVAL_METHOD=hybrid 可以改回 BM25 + 向量的混合檢索
// 不管哪一種，embedding 服務出錯時，單次預審都會退回 BM25（review-context.ts）
const embedder = env.VOYAGE_API_KEY
  ? withEmbeddingCache(createVoyageEmbedder({ apiKey: env.VOYAGE_API_KEY, model: env.VOYAGE_MODEL ?? 'voyage-4-lite' }))
  : undefined
const retriever = !embedder
  ? bm25Retriever
  : env.RETRIEVAL_METHOD === 'hybrid'
    ? createHybridRetriever(embedder)
    : createVectorRetriever(embedder)

const service = createRequestService(store, reviewer, { retriever, embedder })
const api = createApp(service, {
  meta: () => ({
    demo: DEMO,
    ai: limited
      ? { reviewer: reviewer.name, ...limited.usage() }
      : { reviewer: reviewer.name, used: 0, limit: 0 },
  }),
})

// API 一律掛在 /api 底下：前端的路由（例如 /requests/:id）才不會跟 API 撞在一起
// 重新整理 /requests/abc 時，瀏覽器拿到的是頁面，而不是 API 的 JSON
const root = express()
root.use('/api', api)

// 正式環境：同一個服務也提供打包好的 Vue 頁面，只有一個網址、沒有跨網域問題
// 開發時沒有打包檔案，前端由 Vite 的開發伺服器提供
const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
if (existsSync(WEB_DIST)) {
  root.use(express.static(WEB_DIST))
  // 其他頁面路徑都回傳 index.html，交給 Vue Router 處理（單頁應用程式）
  root.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(resolve(WEB_DIST, 'index.html'))
  })
}

const resumed = service.resumeInterruptedReviews()

const PORT = Number(env.PORT ?? 3000)
root.listen(PORT, () => {
  console.log(`伺服器已啟動：http://localhost:${PORT}`)
  console.log(`AI 審查員：${reviewer.name}${limited ? `（每日上限 ${limited.usage().limit} 次）` : ''}`)
  console.log(`檢索：${retriever.name}`)
  console.log(`資料庫：${DB_PATH}`)
  if (seeded > 0) console.log(`已放入 ${seeded} 張示範申請單`)
  if (resumed > 0) console.log(`接續處理 ${resumed} 張預審中斷的申請單`)
  if (existsSync(WEB_DIST)) console.log(`同時提供前端頁面：${WEB_DIST}`)
})
