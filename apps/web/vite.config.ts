import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // 前端打 /api/xxx，Vite 開發伺服器幫忙轉給後端（後端的 API 本來就掛在 /api 底下）
    // 好處：瀏覽器以為是同一個網站，不會有 CORS 問題；上線時前後端是同一個服務，網址完全一樣
    proxy: {
      // E2E 測試會另外開一組後端，所以網址可以用環境變數覆蓋
      '/api': process.env.API_URL ?? 'http://localhost:3001',
    },
  },
})
