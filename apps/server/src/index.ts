import express from 'express'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { createClaudeReviewer } from './claude-reviewer'
import { createLimitedReviewer, type LimitedReviewer } from './limited-reviewer'
import { createRequestService } from './request-service'
import { createRetrievalFromEnv } from './retrieval-config'
import { createMockReviewer, type Reviewer } from './reviewer'
import { seedDemoData } from './seed'
import { createSqliteStore } from './sqlite-store'
import type { EvalRun } from './store'

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
// 規則寫在 retrieval-config.ts：產生參考評估的腳本也用同一套
const { embedder, retriever } = createRetrievalFromEnv(env)

// ===== 評估集 =====
// 公開 demo 預設用模擬審查員跑評估集：任何人都能按「執行評估」，不能讓一次評估就用掉當天的 AI 額度
// 真實 AI 的分數改看 Claude 參考評估（pnpm eval:reference 產生）
// EVAL_REVIEWER=claude 或 mock 可以覆蓋預設
const evalReviewer =
  env.EVAL_REVIEWER === 'claude' ? reviewer : env.EVAL_REVIEWER === 'mock' || DEMO ? mock : reviewer
// EVAL_REFERENCE_PATH：E2E 測試指向自己的測試資料，不受實際的參考評估影響
const REFERENCE_PATH = env.EVAL_REFERENCE_PATH ?? resolve(dirname(fileURLToPath(import.meta.url)), '../eval-reference.json')
const evalReference = existsSync(REFERENCE_PATH) ? (JSON.parse(readFileSync(REFERENCE_PATH, 'utf-8')) as EvalRun) : null

const service = createRequestService(store, reviewer, { retriever, embedder, evalReviewer, evalReference })
const api = createApp(service, {
  meta: () => ({
    demo: DEMO,
    ai: limited
      ? { reviewer: reviewer.name, ...limited.usage() }
      : { reviewer: reviewer.name, used: 0, limit: 0 },
    evalReviewer: evalReviewer.name,
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
  console.log(`評估集審查員：${evalReviewer.name}${evalReference ? `（另有 ${evalReference.reviewer} 的參考評估）` : ''}`)
  console.log(`資料庫：${DB_PATH}`)
  if (seeded > 0) console.log(`已放入 ${seeded} 張示範申請單`)
  if (resumed > 0) console.log(`接續處理 ${resumed} 張預審中斷的申請單`)
  if (existsSync(WEB_DIST)) console.log(`同時提供前端頁面：${WEB_DIST}`)
})
