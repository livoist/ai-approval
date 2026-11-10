import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// E2E 用的 port 跟開發用的（3001、5173）錯開
// 這樣開發伺服器開著的時候也能跑測試，兩邊互不干擾
const API_PORT = 3101
const WEB_PORT = 5273
const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests',
  // 所有測試共用同一個後端，資料會互相看得到；每個測試都自己建新的申請單，所以不會互相影響
  fullyParallel: false,
  forbidOnly: isCI, // CI 上不允許留著 test.only，避免不小心只跑了一個測試
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure', // 失敗時留下逐步錄影，打開就能看到哪一步出錯
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // 跑測試前，Playwright 會自動把前後端都開起來，跑完再關掉
  webServer: [
    {
      command: 'pnpm --filter @ai-approval/server exec tsx src/index.ts',
      cwd: '..',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        DB_PATH: ':memory:', // 每次都從乾淨的資料開始
        MOCK_DELAY_MS: '50', // 串流還是一條一條出來，只是快很多
        ANTHROPIC_API_KEY: '', // 一律用 mock：測試不能花錢，結果也要固定
        VOYAGE_API_KEY: '', // 檢索一律用 BM25：不呼叫外部服務
        // 參考評估用固定的測試資料（用模擬審查員產生），不受實際的 eval-reference.json 影響
        EVAL_REFERENCE_PATH: fileURLToPath(new URL('./fixtures/eval-reference.json', import.meta.url)),
      },
    },
    {
      command: `pnpm --filter @ai-approval/web exec vite --port ${WEB_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
})
