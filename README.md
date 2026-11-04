# AI 預審簽核系統

員工送出申請單時，AI 依公司規範預審、標出缺漏與風險並附條文依據，主管再據此簽核；AI 不做決定，全程可追溯。

## 專案結構

```
ai-approval/
├── apps/              # 之後放 web（Vue 3）與 server（Express）
└── packages/
    └── shared/        # 前後端共用：型別、簽核狀態機
```

## 開始

需要 Node.js 20 以上與 pnpm。

```bash
pnpm install
pnpm test
```

## 設計決策

### 簽核狀態用轉換表管理，前後端共用

所有合法的狀態變化集中寫在 `packages/shared/src/request-machine.ts` 的 `TRANSITIONS`。
前端用 `availableEvents()` 決定顯示哪些按鈕，後端用 `transition()` 驗證請求是否合法，
兩邊讀同一張表，不會出現「畫面上有按鈕、後端卻拒絕」或反過來的狀況。
