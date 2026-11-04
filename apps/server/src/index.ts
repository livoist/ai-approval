import { createApp } from './app'
import { createClaudeReviewer } from './claude-reviewer'
import { createRequestService } from './request-service'
import { mockReviewer } from './reviewer'
import { createStore } from './store'

// 讀取 .env（Node 內建功能，不用另外裝 dotenv）；沒有這個檔案就略過
try {
  process.loadEnvFile()
} catch {}

// 有 API key 就用 Claude，沒有就用假的審查員，開發不會因此卡住
const apiKey = process.env.ANTHROPIC_API_KEY
const reviewer = apiKey
  ? createClaudeReviewer({ apiKey, model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5' })
  : mockReviewer

// 在這裡把各層組裝起來：store → service → app
const store = createStore()
const service = createRequestService(store, reviewer)
const app = createApp(service)

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`伺服器已啟動：http://localhost:${PORT}`)
  console.log(`AI 審查員：${reviewer.name}`)
})
