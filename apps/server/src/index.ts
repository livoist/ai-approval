import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app'
import { createClaudeReviewer } from './claude-reviewer'
import { createRequestService } from './request-service'
import { createMockReviewer } from './reviewer'
import { createSqliteStore } from './sqlite-store'

// 讀取 .env（Node 內建功能，不用另外裝 dotenv）；沒有這個檔案就略過
try {
  process.loadEnvFile()
} catch {}

// 有 API key 就用 Claude，沒有就用假的審查員，開發不會因此卡住
const apiKey = process.env.ANTHROPIC_API_KEY
const reviewer = apiKey
  ? createClaudeReviewer({ apiKey, model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5' })
  : // 每條意見間隔 0.8 秒，模擬 AI 思考；E2E 測試時調短，讓測試跑得快
    createMockReviewer({ delayMs: Number(process.env.MOCK_DELAY_MS ?? 800) })

// 資料存在 SQLite 檔案裡，重開伺服器也不會消失
// DB_PATH 設成 :memory: 時只存在記憶體，E2E 測試每次都從乾淨的資料開始
// 想清空重來：執行 pnpm --filter @ai-approval/server db:reset
const DB_PATH = process.env.DB_PATH ?? 'data/app.db'
mkdirSync(dirname(DB_PATH), { recursive: true })

// 在這裡把各層組裝起來：store → service → app
// 從記憶體換成 SQLite，整個專案只改了這一行
const store = createSqliteStore(DB_PATH)
const service = createRequestService(store, reviewer)
const app = createApp(service)

const resumed = service.resumeInterruptedReviews()

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`伺服器已啟動：http://localhost:${PORT}`)
  console.log(`AI 審查員：${reviewer.name}`)
  console.log(`資料庫：${DB_PATH}`)
  if (resumed > 0) console.log(`接續處理 ${resumed} 張預審中斷的申請單`)
})
