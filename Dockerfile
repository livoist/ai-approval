# ---------------------------------------------------------------
# AI 預審簽核系統的 Docker 映像檔
# 做的事情跟 render.yaml 的 buildCommand / startCommand 一樣，
# 只是把「環境」也一起打包：Linux + Node.js 22 + 套件 + 程式碼
# ---------------------------------------------------------------

# 1. 起點：一台裝好 Node.js 22 的精簡版 Linux
FROM node:22-slim

# 2. 之後的指令都在容器裡的 /app 資料夾執行
WORKDIR /app

# 3. 啟用 corepack，它會依 package.json 的 packageManager 欄位安裝對應版本的 pnpm
RUN corepack enable

# 4. 先只複製「套件清單」，再安裝套件
#    Docker 會把每一步的結果存成快取：只要這些清單沒變，下次 build 就直接沿用，
#    不用每改一行程式碼就重新安裝一次全部套件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile

# 5. 再複製全部程式碼（.dockerignore 列出的檔案會被排除）
COPY . .

# 6. 打包前端，產生 apps/web/dist，後端啟動時會一起提供這些頁面
RUN pnpm --filter @ai-approval/web build

# 7. 告訴使用這個映像檔的人：服務在容器內的 3000 port
ENV PORT=3000
EXPOSE 3000

# 8. 容器啟動時執行的指令（跟 render.yaml 的 startCommand 一樣）
CMD ["pnpm", "--filter", "@ai-approval/server", "start"]
