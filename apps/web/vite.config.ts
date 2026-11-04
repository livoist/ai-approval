import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // 前端打 /api/xxx，Vite 開發伺服器幫忙轉給後端的 /xxx
    // 好處：瀏覽器以為是同一個網站，不會有 CORS 問題，前端程式碼也不用寫死後端網址
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
