import { defineConfig, devices } from '@playwright/test'

// 錄 demo 影片與 README 截圖用的設定，不是測試
// 跟 E2E 的差別：
// - DEMO=true：一打開就有各種狀態的示範資料，畫面不會空空的
// - MOCK_DELAY_MS 比較長：看得到 AI 意見一條一條長出來
// - 開錄影，影片與截圖存到 docs/
// port 跟開發（3001、5173）和 E2E（3101、5273）都錯開，三者可以同時開著
const API_PORT = 3201
const WEB_PORT = 5373
const SIZE = { width: 1280, height: 800 }

export default defineConfig({
  testDir: './demo',
  timeout: 120_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: SIZE,
    video: { mode: 'on', size: SIZE },
  },
  webServer: [
    {
      command: 'pnpm --filter @ai-approval/server exec tsx src/index.ts',
      cwd: '..',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        DB_PATH: ':memory:',
        DEMO: 'true',
        MOCK_DELAY_MS: '600',
        ANTHROPIC_API_KEY: '', // 錄影一律用 mock：結果固定，每次錄出來都一樣
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
